import { and, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogCategories, catalogProducts, catalogStockSucursal, sucursales } from "@/db/schema"
import { getItemParaEspejo, type AlegraProduct } from "./alegra"
import {
  estadoSoloSecundaria,
  mapItemSecundario,
  normalizarCodigo,
  parearPadres,
  parearPorCodigo,
  type ItemPrincipalPareo,
} from "./alegra-pareo"
import { escribirStock } from "./alegra-sync-cuenta"
import { upsertProductosSecundaria } from "./catalog-products-repo"
import { absorberSoloSecundaria, claveEfectivaSql, copiarOverlaySiFalta, listasDeLaPrincipal, normCodigoSql } from "./catalogo-union-repo"
import { configParaCuenta } from "./sucursales-cuenta"
import type { TenantConfig } from "./tenants"
import type { TipoItem } from "./variantes-puras"

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
//  - Variantes (S3): el padre y sus variantes comparten código, así que el ítem se identifica por
//    (código, opción). Un hijo desconocido entra como `<slug>:<id>` si no tiene par aunque un
//    hermano comparta el código. Un PADRE nunca lleva stock vendible: si no se pareó con un padre de
//    la principal se guarda como ancla del grupo (`tipo='padre'`).
//  - Fila propia que la principal ya absorbió (el modelo se cargó primero acá y después en la
//    principal): se corre la absorción de la sync y, si tiene par activo, NO se refresca —el upsert
//    limpia `reemplazado_por_alegra_id` y la reactivaba como duplicado—; su stock va a la principal.
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
    .select({
      alegraId: catalogProducts.alegraId,
      categoryAlegraId: catalogProducts.categoryAlegraId,
      padreAlegraId: catalogProducts.padreAlegraId,
    })
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

  // Fila propia que la principal ya absorbió (o que hoy tiene par activo): no se refresca —eso la
  // reactivaría—; su stock va a la fila de la principal, como en un par.
  if (propio) {
    const principal = await reabsorber(tenantId, sintetico)
    if (principal) {
      if (item.tipo !== "padre") {
        await escribirStock(tenantId, slugs, [{ alegraId: principal, itemIdCuenta: idEnCuenta, stock: item.stock }], leidoAt, "webhook")
      }
      return "pareado"
    }
  }

  const clave = normalizarCodigo(item.code)
  const tipo: TipoItem = item.tipo ?? "simple"
  const opcion = item.varianteClave ?? ""

  // Padre (S3): nunca stock ni venta. Pareado con un padre de la principal no hace falta guardarlo
  // (el ancla es el de la principal); si no, es la fila ancla del grupo de la secundaria.
  if (tipo === "padre") {
    if (!propio) {
      const delPadre = await padresDeLaPrincipal(tenantId, clave)
      if (parearPadres(delPadre, [{ alegraId: idEnCuenta, code: item.code, tipo: "padre" }]).pares.length > 0) return "pareado"
    }
    await escribirSoloSecundaria(base, cuenta, slugs, item, { adoptada: false, categoriaPrevia: propio?.categoryAlegraId ?? null, sinStock: true }, leidoAt)
    return propio ? "solo_secundaria" : "nuevo"
  }

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
            tipo: catalogProducts.tipo,
            varianteClave: catalogProducts.varianteClave,
          })
          .from(catalogProducts)
          .where(and(eq(catalogProducts.tenantId, tenantId), sql`${catalogProducts.cuentaId} is null`, sql`${codigoSql} = ${clave}`))
      ).map((r) => ({
        alegraId: r.alegraId,
        code: r.code,
        activo: r.status === "active" && r.alegraStatus !== "inactive",
        tipo: r.tipo as TipoItem,
        varianteClave: r.varianteClave,
      }))
    : []

  // Una variante se identifica por (código, opción): sin opción no se puede parear ni dar de alta.
  const sinOpcion = tipo === "variante" && !opcion

  // Es un producto propio ya conocido: se refresca y listo (su estado depende de la adopción).
  if (propio) {
    // Solo cuentan las filas de la principal del mismo tipo y la misma opción.
    const mismas = principales.filter((p) => (p.tipo ?? "simple") === tipo && (p.varianteClave ?? "") === opcion)
    const adoptada = mismas.some((p) => !p.activo) && !mismas.some((p) => p.activo)
    // Un grupo ya unificado con el padre de la principal conserva ese padre (el webhook no lo pisa).
    const padreCanonico =
      item.padreAlegraId && propio.padreAlegraId && !propio.padreAlegraId.startsWith(`${slug}:`)
        ? new Map([[item.padreAlegraId, propio.padreAlegraId]])
        : undefined
    await escribirSoloSecundaria(base, cuenta, slugs, item, { adoptada, categoriaPrevia: propio.categoryAlegraId, padresCanonicos: padreCanonico }, leidoAt)
    return "solo_secundaria"
  }

  // Ítem que no conocemos: se lo empareja por (código, opción) con las mismas reglas de la sync.
  if (!clave || sinOpcion) return "ignorado"
  // Otros ítems de ESTA cuenta ya conocidos con el mismo código y la misma opción (pareados o
  // propios): duplicado. Los hermanos con OTRA opción no cuentan.
  const otros = await db.execute(sql`
    SELECT css.item_id_cuenta AS id, p.code AS code, p.tipo AS tipo, p.variante_clave AS clave
    FROM catalog_stock_sucursal css
    JOIN catalog_products p ON p.tenant_id = css.tenant_id AND p.alegra_id = css.alegra_id
    WHERE css.tenant_id = ${tenantId} AND css.sucursal IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
      AND css.item_id_cuenta IS NOT NULL AND css.item_id_cuenta <> ${idEnCuenta}
      AND ${sql.raw(normCodigoSql("p.code"))} = ${clave}
      AND p.tipo = ${tipo} AND ${sql.raw(claveEfectivaSql("p"))} = ${opcion}
    UNION
    SELECT p.alegra_id_cuenta AS id, p.code AS code, p.tipo AS tipo, p.variante_clave AS clave
    FROM catalog_products p
    WHERE p.tenant_id = ${tenantId} AND p.cuenta_id = ${cuenta.id}::uuid AND p.alegra_id <> ${sintetico}
      AND ${sql.raw(normCodigoSql("p.code"))} = ${clave}
      AND p.tipo = ${tipo} AND ${sql.raw(claveEfectivaSql("p"))} = ${opcion}
  `)
  const secundarios = [
    { alegraId: idEnCuenta, code: item.code, tipo, varianteClave: item.varianteClave ?? null },
    ...(otros as unknown as { id: string | null; code: string | null; tipo: TipoItem; clave: string | null }[])
      .filter((o) => o.id)
      .map((o) => ({ alegraId: o.id as string, code: o.code, tipo: o.tipo, varianteClave: o.clave })),
  ]
  const pareo = parearPorCodigo(principales, secundarios)

  const par = pareo.pares.find((p) => p.secundarioAlegraId === idEnCuenta)
  if (par) {
    await escribirStock(tenantId, slugs, [{ alegraId: par.principalAlegraId, itemIdCuenta: idEnCuenta, stock: item.stock }], leidoAt, "webhook")
    return "nuevo"
  }
  const solo = pareo.soloSecundaria.find((s) => s.secundarioAlegraId === idEnCuenta)
  if (solo) {
    // Una variante nueva necesita su ancla: el padre de la principal (si se parearon) o el de esta cuenta.
    let padresCanonicos: Map<string, string> | undefined
    if (tipo === "variante" && item.padreAlegraId) {
      const r = await resolverPadre(base, cuenta, cfg, item.padreAlegraId, deps, opts)
      if (r.canonico) padresCanonicos = new Map([[item.padreAlegraId, r.canonico]])
      if (r.ancla) await escribirSoloSecundaria(base, cuenta, slugs, r.ancla, { adoptada: false, categoriaPrevia: null, sinStock: true }, leidoAt)
    }
    await escribirSoloSecundaria(base, cuenta, slugs, item, { adoptada: solo.principalInactivaAlegraId != null, categoriaPrevia: null, padresCanonicos }, leidoAt)
    if (solo.principalInactivaAlegraId) await copiarOverlaySiFalta(db, tenantId, solo.principalInactivaAlegraId, sintetico)
    return "nuevo"
  }
  return "ignorado"
}

/**
 * Corre la absorción de la sync (`absorberSoloSecundaria`, idempotente) y devuelve la fila de la
 * principal que absorbió a ESTA, o null si sigue siendo solo-secundaria.
 */
async function reabsorber(tenantId: string, sintetico: string): Promise<string | null> {
  await absorberSoloSecundaria(tenantId)
  const [fila] = await getDb()
    .select({ reemplazadoPor: catalogProducts.reemplazadoPorAlegraId })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.alegraId, sintetico)))
  return fila?.reemplazadoPor ?? null
}

/** Padres ACTIVOS de la principal con ese código normalizado (para parear el padre de la secundaria). */
async function padresDeLaPrincipal(tenantId: string, clave: string): Promise<ItemPrincipalPareo[]> {
  if (!clave) return []
  const filas = await getDb()
    .select({
      alegraId: catalogProducts.alegraId,
      code: catalogProducts.code,
      status: catalogProducts.status,
      alegraStatus: catalogProducts.alegraStatus,
    })
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.tenantId, tenantId),
        sql`${catalogProducts.cuentaId} is null`,
        eq(catalogProducts.tipo, "padre"),
        sql`${codigoSql} = ${clave}`,
      ),
    )
  return filas.map((r) => ({
    alegraId: r.alegraId,
    code: r.code,
    activo: r.status === "active" && r.alegraStatus !== "inactive",
    tipo: "padre" as const,
  }))
}

/**
 * Ancla del grupo de una variante nueva. Si la fila ancla `<slug>:<padre>` ya existe no hay nada que
 * hacer. Si no, se lee el padre de la cuenta: pareado con un padre de la principal -> su id canónico;
 * sin par -> se devuelve para guardarlo como ancla.
 */
async function resolverPadre(
  base: TenantConfig,
  cuenta: typeof alegraCuentas.$inferSelect,
  cfg: TenantConfig,
  idPadreEnCuenta: string,
  deps: DepsRefrescoCuenta,
  opts: { reintentos429?: number; onRequest?: () => void },
): Promise<{ canonico: string | null; ancla: AlegraProduct | null }> {
  const tenantId = base.id
  const sinteticoPadre = `${cuenta.slug}:${idPadreEnCuenta}`
  const [existe] = await getDb()
    .select({ alegraId: catalogProducts.alegraId })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.alegraId, sinteticoPadre), eq(catalogProducts.cuentaId, cuenta.id)))
  if (existe) return { canonico: null, ancla: null }
  const padre = await deps.getItem(cfg, idPadreEnCuenta, opts)
  if (!padre || padre.tipo !== "padre") return { canonico: null, ancla: null }
  const par = parearPadres(await padresDeLaPrincipal(tenantId, normalizarCodigo(padre.code)), [
    { alegraId: padre.alegraId, code: padre.code, tipo: "padre" },
  ]).pares[0]
  return par ? { canonico: par.principalAlegraId, ancla: null } : { canonico: null, ancla: padre }
}

async function escribirSoloSecundaria(
  base: TenantConfig,
  cuenta: typeof alegraCuentas.$inferSelect,
  slugs: string[],
  item: AlegraProduct,
  o: { adoptada: boolean; categoriaPrevia: string | null; padresCanonicos?: ReadonlyMap<string, string>; sinStock?: boolean },
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
  const m = mapItemSecundario(item, { id: cuenta.id, slug: cuenta.slug }, listas, [], categoriasPrincipal, o.padresCanonicos)
  // Sin las categorías de la cuenta a mano no se puede resolver la del ítem: se conserva la que ya
  // tenía la fila (la daily sync la corrige si cambió).
  const producto = { ...m.producto, categoryAlegraId: o.categoriaPrevia ?? m.producto.categoryAlegraId }
  await upsertProductosSecundaria(
    tenantId,
    cuenta.id,
    [{ producto, alegraIdCuenta: m.alegraIdCuenta, estado: estadoSoloSecundaria(o.adoptada, producto.stock) }],
    { leidoAt, leidoPor: "webhook" },
  )
  // El ancla de un grupo (padre) no lleva stock.
  if (o.sinStock) return
  await escribirStock(tenantId, slugs, [{ alegraId: producto.alegraId, itemIdCuenta: m.alegraIdCuenta, stock: producto.stock }], leidoAt, "webhook")
}
