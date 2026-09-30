import { and, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogCategories, catalogProducts, catalogStockSucursal, sucursales } from "@/db/schema"
import { getItemParaEspejo, type AlegraProduct } from "./alegra"
import {
  estadoSoloSecundaria,
  mapItemSecundario,
  normalizarCodigo,
  parearPorCodigo,
  type ItemPrincipalPareo,
} from "./alegra-pareo"
import { escribirStock } from "./alegra-sync-cuenta"
import { upsertProductosSecundaria } from "./catalog-products-repo"
import { copiarOverlaySiFalta, listasDeLaPrincipal, normCodigoSql } from "./catalogo-union-repo"
import { configParaCuenta } from "./sucursales-cuenta"
import type { TenantConfig } from "./tenants"

// Re-lectura de UN ítem de una cuenta SECUNDARIA a partir de un aviso de webhook (change
// `sucursales-igz-mdp`, rebanada D, D2). La cola (`alegra_item_refresh`) guarda los ítems de una
// secundaria con el id `<slug>:<id_en_cuenta>` (mismo formato que el `alegra_id` sintético): el
// drenador ve el ":" y llama acá en vez de leer de la cuenta principal.
//
// Qué hace, según lo que ya se sabe del ítem (mismas reglas que `syncCuentaSecundaria`):
//  - PAREADO (hay una fila de stock por sucursal con ese `item_id_cuenta` y su producto es de la
//    principal): actualiza SOLO `catalog_stock_sucursal`. Nada más del producto.
//  - SOLO-SECUNDARIA (el producto es de esta cuenta): refresca sus datos y su stock, con el estado
//    por adopción (O8, #671): si la principal lo tiene inactivo, activo solo con stock > 0.
//  - DESCONOCIDO (no está pareado ni es una fila propia): se lo empareja por código con las mismas
//    reglas de la sync. Par → stock de la sucursal; solo-secundaria → fila nueva; duplicado o sin
//    código → se ignora (lo informa la sync).
//  - Borrado en Alegra (404): stock 0; si era solo-secundaria queda inactivo.
// Nunca toca `catalog_products` de la principal ni la cola de otra cuenta.

export type ResultadoCuenta = "pareado" | "solo_secundaria" | "nuevo" | "baja" | "ignorado"

export interface DepsRefrescoCuenta {
  getItem: (config: TenantConfig, alegraId: string, opts: { reintentos429?: number; onRequest?: () => void }) => Promise<AlegraProduct | null>
}

const DEPS: DepsRefrescoCuenta = { getItem: getItemParaEspejo }

/** `mdp:1234` -> `{ slug: "mdp", idEnCuenta: "1234" }`; null si no tiene ese formato. */
export function partirIdDeCola(id: string): { slug: string; idEnCuenta: string } | null {
  const i = id.indexOf(":")
  if (i <= 0 || i === id.length - 1) return null
  return { slug: id.slice(0, i), idEnCuenta: id.slice(i + 1) }
}

const codigoSql = sql.raw(normCodigoSql("code"))

export async function refrescarItemDeCuenta(
  base: TenantConfig,
  idCola: string,
  leidoAt: Date,
  opts: { reintentos429?: number; onRequest?: () => void } = {},
  deps: DepsRefrescoCuenta = DEPS,
): Promise<ResultadoCuenta> {
  const partido = partirIdDeCola(idCola)
  if (!partido) return "ignorado"
  const { slug, idEnCuenta } = partido
  const tenantId = base.id
  const db = getDb()

  const [cuenta] = await db
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.slug, slug), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
  if (!cuenta) return "ignorado"
  const slugs = (
    await db
      .select({ slug: sucursales.slug })
      .from(sucursales)
      .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.cuentaAlegraId, cuenta.id)))
  ).map((s) => s.slug)
  if (slugs.length === 0) return "ignorado"

  // Lanza si la cuenta no tiene credenciales: el drenador lo anota como error de esa fila.
  const cfg = configParaCuenta(base, cuenta)
  const item = await deps.getItem(cfg, idEnCuenta, opts)
  const sintetico = idCola

  // ¿Qué producto del catálogo es este ítem?
  const [enStock] = await db
    .select({ alegraId: catalogStockSucursal.alegraId })
    .from(catalogStockSucursal)
    .where(
      and(
        eq(catalogStockSucursal.tenantId, tenantId),
        inArray(catalogStockSucursal.sucursal, slugs),
        eq(catalogStockSucursal.itemIdCuenta, idEnCuenta),
      ),
    )
    .limit(1)
  const [propio] = await db
    .select({ alegraId: catalogProducts.alegraId, categoryAlegraId: catalogProducts.categoryAlegraId })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.alegraId, sintetico), eq(catalogProducts.cuentaId, cuenta.id)))

  // 404: stock 0 (y, si era solo-secundaria, inactivo).
  if (!item) {
    const alegraId = propio?.alegraId ?? enStock?.alegraId
    if (!alegraId) return "ignorado"
    await escribirStock(tenantId, slugs, [{ alegraId, itemIdCuenta: idEnCuenta, stock: 0 }], leidoAt, "webhook")
    if (propio) {
      await db.execute(sql`
        UPDATE catalog_products
        SET status = 'inactive', stock = 0, alegra_leido_at = ${leidoAt.toISOString()}::timestamptz, leido_por = 'webhook'
        WHERE tenant_id = ${tenantId} AND alegra_id = ${sintetico} AND cuenta_id = ${cuenta.id}::uuid
          AND coalesce(alegra_leido_at, '-infinity'::timestamptz) <= ${leidoAt.toISOString()}::timestamptz
      `)
    }
    return "baja"
  }

  const clave = normalizarCodigo(item.code)

  // Pareado con un producto de la principal: solo stock.
  if (enStock && !propio) {
    await escribirStock(tenantId, slugs, [{ alegraId: enStock.alegraId, itemIdCuenta: idEnCuenta, stock: item.stock }], leidoAt, "webhook")
    return "pareado"
  }

  // Filas de la principal con el mismo código (activas o no): para el pareo y la adopción.
  const principales: ItemPrincipalPareo[] = clave
    ? (
        await db
          .select({
            alegraId: catalogProducts.alegraId,
            code: catalogProducts.code,
            status: catalogProducts.status,
            alegraStatus: catalogProducts.alegraStatus,
          })
          .from(catalogProducts)
          .where(and(eq(catalogProducts.tenantId, tenantId), sql`${catalogProducts.cuentaId} is null`, sql`${codigoSql} = ${clave}`))
      ).map((r) => ({ alegraId: r.alegraId, code: r.code, activo: r.status === "active" && r.alegraStatus !== "inactive" }))
    : []

  // Es un producto propio ya conocido: se refresca y listo (su estado depende de la adopción).
  if (propio) {
    const adoptada = principales.some((p) => !p.activo) && !principales.some((p) => p.activo)
    await escribirSoloSecundaria(base, cuenta, slugs, item, { adoptada, categoriaPrevia: propio.categoryAlegraId }, leidoAt)
    return "solo_secundaria"
  }

  // Ítem que no conocemos: se lo empareja por código con las mismas reglas de la sync.
  if (!clave) return "ignorado"
  // Otros ítems de ESTA cuenta ya conocidos con el mismo código (pareados o propios): duplicado.
  const otros = await db.execute(sql`
    SELECT css.item_id_cuenta AS id, p.code AS code
    FROM catalog_stock_sucursal css
    JOIN catalog_products p ON p.tenant_id = css.tenant_id AND p.alegra_id = css.alegra_id
    WHERE css.tenant_id = ${tenantId} AND css.sucursal IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
      AND css.item_id_cuenta IS NOT NULL AND css.item_id_cuenta <> ${idEnCuenta}
      AND ${sql.raw(normCodigoSql("p.code"))} = ${clave}
    UNION
    SELECT p.alegra_id_cuenta AS id, p.code AS code
    FROM catalog_products p
    WHERE p.tenant_id = ${tenantId} AND p.cuenta_id = ${cuenta.id}::uuid AND p.alegra_id <> ${sintetico}
      AND ${sql.raw(normCodigoSql("p.code"))} = ${clave}
  `)
  const secundarios = [
    { alegraId: idEnCuenta, code: item.code },
    ...(otros as unknown as { id: string | null; code: string | null }[])
      .filter((o) => o.id)
      .map((o) => ({ alegraId: o.id as string, code: o.code })),
  ]
  const pareo = parearPorCodigo(principales, secundarios)

  const par = pareo.pares.find((p) => p.secundarioAlegraId === idEnCuenta)
  if (par) {
    await escribirStock(tenantId, slugs, [{ alegraId: par.principalAlegraId, itemIdCuenta: idEnCuenta, stock: item.stock }], leidoAt, "webhook")
    return "nuevo"
  }
  const solo = pareo.soloSecundaria.find((s) => s.secundarioAlegraId === idEnCuenta)
  if (solo) {
    await escribirSoloSecundaria(base, cuenta, slugs, item, { adoptada: solo.principalInactivaAlegraId != null, categoriaPrevia: null }, leidoAt)
    if (solo.principalInactivaAlegraId) await copiarOverlaySiFalta(db, tenantId, solo.principalInactivaAlegraId, sintetico)
    return "nuevo"
  }
  return "ignorado"
}

async function escribirSoloSecundaria(
  base: TenantConfig,
  cuenta: typeof alegraCuentas.$inferSelect,
  slugs: string[],
  item: AlegraProduct,
  o: { adoptada: boolean; categoriaPrevia: string | null },
  leidoAt: Date,
): Promise<void> {
  const tenantId = base.id
  const listas = await listasDeLaPrincipal(tenantId)
  const categoriasPrincipal = (
    await getDb()
      .select({ alegraId: catalogCategories.alegraId, name: catalogCategories.name })
      .from(catalogCategories)
      .where(eq(catalogCategories.tenantId, tenantId))
  ).map((c) => ({ alegraId: c.alegraId, name: c.name }))
  const m = mapItemSecundario(item, { id: cuenta.id, slug: cuenta.slug }, listas, [], categoriasPrincipal)
  // Sin las categorías de la cuenta a mano no se puede resolver la del ítem: se conserva la que ya
  // tenía la fila (la daily sync la corrige si cambió).
  const producto = { ...m.producto, categoryAlegraId: o.categoriaPrevia ?? m.producto.categoryAlegraId }
  await upsertProductosSecundaria(
    tenantId,
    cuenta.id,
    [{ producto, alegraIdCuenta: m.alegraIdCuenta, estado: estadoSoloSecundaria(o.adoptada, producto.stock) }],
    { leidoAt, leidoPor: "webhook" },
  )
  await escribirStock(tenantId, slugs, [{ alegraId: producto.alegraId, itemIdCuenta: m.alegraIdCuenta, stock: producto.stock }], leidoAt, "webhook")
}
