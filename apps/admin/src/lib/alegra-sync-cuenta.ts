import { and, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogCategories, catalogProducts, catalogStockSucursal, catalogSyncLog, sucursales } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import { listAllCategories, listAllItems, type AlegraProduct } from "./alegra"
import { configParaCuenta, type CuentaCredenciales } from "./sucursales-cuenta"
import {
  estadoSoloSecundaria,
  mapItemSecundario,
  parearPorCodigo,
  type ItemPrincipalPareo,
  type ItemSecundarioMapeado,
} from "./alegra-pareo"
import { upsertProductosSecundaria, type ProductoSecundaria } from "./catalog-products-repo"
import { abrirCorrida, baseDeCorrida, evaluarCorrida, MSG_SYNC_EN_CURSO } from "./alegra-sync-guarda"
import {
  absorberSoloSecundaria,
  copiarOverlaySiFalta,
  empujarNoVendiblesDeCuenta,
  listasDeLaPrincipal,
} from "./catalogo-union-repo"
import { avisarShop } from "./aviso-shop"

// Sync de una cuenta de Alegra SECUNDARIA (change `sucursales-igz-mdp`, rebanada D, design D3).
// El catálogo de la tienda es la UNIÓN de las cuentas del tenant emparejadas por código:
//  - PAREADOS (código único a ambos lados con la principal ACTIVA): se escribe SOLO el stock, en
//    `catalog_stock_sucursal`. Nombre, precio, foto, estado, todo lo demás lo define la principal.
//  - SOLO-SECUNDARIA (código único acá y sin fila principal ACTIVA): fila propia en
//    `catalog_products` con `alegra_id` sintético `<slug>:<id_en_cuenta>`, más su stock. Si la
//    principal lo tiene INACTIVO (O8, #671) el ítem se "adopta": se muestra sólo mientras esta
//    cuenta tenga stock (> 0) y vuelve a mandar la principal cuando esta lo reactiva (absorción).
//  - Código duplicado o faltante: NO entra (ni catálogo ni stock); se informa en `resumen`.
// No se llama a Alegra con credenciales de otra cuenta: `configParaCuenta` lanza si faltan.

const LOTE = 500

export const MSG_SIN_SUCURSAL = "La cuenta de Alegra no está asignada a ninguna sucursal."
export const MSG_CUENTA_PRINCIPAL = "La cuenta principal se sincroniza con la sincronización del catálogo."
/** Tope de filas de cada lista de "Códigos a revisar" que se guarda en el resumen. */
export const TOPE_LISTA_REVISAR = 200

export interface CuentaSync extends CuentaCredenciales {
  id: string
  nombre: string
}

export interface ItemRevisar {
  alegraId: string
  codigo: string | null
  nombre: string
}

export interface DuplicadoRevisar {
  codigo: string
  /** Ids (en la principal) de las filas activas con ese código, si el duplicado está de ese lado. */
  principal: string[]
  secundaria: ItemRevisar[]
}

/** Detalle de una corrida de una cuenta secundaria; se guarda en `catalog_sync_log.resumen`. */
export interface ResumenSync {
  v: 1
  cuenta: string
  /** Ítems leídos de la cuenta. */
  items: number
  pareados: number
  soloSecundaria: number
  /** Solo-secundaria "adoptados" porque la principal los tiene inactivos (O8). */
  adoptados: number
  /** Ítems principales activos sin código (no se pueden parear): solo el total. */
  sinCodigoPrincipal: number
  duplicados: { total: number; items: DuplicadoRevisar[] }
  sinCodigo: { total: number; items: ItemRevisar[] }
  /** Nombres de listas de precio de la cuenta sin equivalente por nombre en la principal (O9). */
  listasSinEquivalente: string[]
  /** Solo-secundaria que quedaron sin ningún precio (no se pueden vender). */
  sinPrecio: number
  categoriasSinEquivalente: number
}

export interface SyncCuentaResult {
  ok: boolean
  cuenta: string
  parcial?: boolean
  motivo?: string
  itemsSynced: number
  categoriesSynced: number
  pareados?: number
  soloSecundaria?: number
  duplicados?: number
  sinCodigo?: number
  error?: string
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const cortar = <T>(xs: T[]): T[] => xs.slice(0, TOPE_LISTA_REVISAR)

export interface FilaStock {
  alegraId: string
  itemIdCuenta: string
  stock: number | null
}

/** Escribe el stock de la cuenta en cada una de sus sucursales. No pisa pares manuales ni lecturas más frescas. */
export async function escribirStock(
  tenantId: string,
  slugs: string[],
  filas: FilaStock[],
  leidoAt: Date,
  origen: "sync" | "webhook" = "sync",
): Promise<void> {
  const db = getDb()
  for (const lote of chunk(filas, LOTE)) {
    const ahora = new Date()
    await db
      .insert(catalogStockSucursal)
      .values(
        slugs.flatMap((sucursal) =>
          lote.map((f) => ({
            tenantId,
            sucursal,
            alegraId: f.alegraId,
            itemIdCuenta: f.itemIdCuenta,
            stock: String(f.stock ?? 0),
            origen,
            leidoAt,
            syncedAt: ahora,
          })),
        ),
      )
      .onConflictDoUpdate({
        target: [catalogStockSucursal.tenantId, catalogStockSucursal.sucursal, catalogStockSucursal.alegraId],
        set: {
          itemIdCuenta: sql`excluded.item_id_cuenta`,
          stock: sql`excluded.stock`,
          origen: sql`excluded.origen`,
          leidoAt: sql`excluded.leido_at`,
          syncedAt: sql`excluded.synced_at`,
        },
        setWhere: sql`${catalogStockSucursal.origen} <> 'manual'
          AND coalesce(${catalogStockSucursal.leidoAt}, '-infinity'::timestamptz) <= excluded.leido_at`,
      })
  }
}

export async function syncCuentaSecundaria(
  base: TenantConfig,
  cuenta: CuentaSync,
  trigger: "cron" | "manual",
  opts: { aceptarBaja?: boolean } = {},
): Promise<SyncCuentaResult> {
  const db = getDb()
  const tenantId = base.id
  const fallo = (error: string): SyncCuentaResult => ({ ok: false, cuenta: cuenta.slug, itemsSynced: 0, categoriesSynced: 0, error })

  if (cuenta.principal) return fallo(MSG_CUENTA_PRINCIPAL)

  // La base se toma ANTES de abrir el log de esta corrida (cada cuenta tiene la suya).
  const baseCorrida = await baseDeCorrida(tenantId, cuenta.id)
  const runStart = new Date()
  const logId = await abrirCorrida(tenantId, cuenta.id, trigger, runStart)
  if (!logId) return fallo(MSG_SYNC_EN_CURSO)

  try {
    const cfg = configParaCuenta(base, cuenta)

    const suc = await db
      .select({ slug: sucursales.slug })
      .from(sucursales)
      .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.cuentaAlegraId, cuenta.id)))
    const slugs = suc.map((s) => s.slug)
    if (slugs.length === 0) throw new Error(MSG_SIN_SUCURSAL)

    // Si la principal ya dio de alta un código que era solo-secundaria (y su propia corrida no
    // llegó a absorberlo), se resuelve antes de escribir: evita dos filas activas por código.
    await absorberSoloSecundaria(tenantId)

    // ── Lectura de la cuenta ──
    const categorias = await listAllCategories(cfg)
    const items = await listAllItems(cfg)

    // Pares forzados a mano desde el admin (`origen='manual'`): la sync no los pisa ni los trata
    // como solo-secundaria.
    const manuales = new Set(
      (
        await db
          .select({ item: catalogStockSucursal.itemIdCuenta })
          .from(catalogStockSucursal)
          .where(
            and(
              eq(catalogStockSucursal.tenantId, tenantId),
              inArray(catalogStockSucursal.sucursal, slugs),
              eq(catalogStockSucursal.origen, "manual"),
            ),
          )
      )
        .map((r) => r.item)
        .filter((x): x is string => !!x),
    )
    const itemsAuto = items.filter((it) => !manuales.has(it.alegraId))

    // ── Pareo contra el espejo de la principal ──
    const filasPrincipal = await db
      .select({
        alegraId: catalogProducts.alegraId,
        code: catalogProducts.code,
        status: catalogProducts.status,
        alegraStatus: catalogProducts.alegraStatus,
      })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenantId), sql`${catalogProducts.cuentaId} is null`))
    const principales: ItemPrincipalPareo[] = filasPrincipal.map((r) => ({
      alegraId: r.alegraId,
      code: r.code,
      activo: r.status === "active" && r.alegraStatus !== "inactive",
    }))
    const pareo = parearPorCodigo(
      principales,
      itemsAuto.map((it) => ({ alegraId: it.alegraId, code: it.code })),
    )
    const porId = new Map<string, AlegraProduct>(itemsAuto.map((it) => [it.alegraId, it]))

    // ── 1) Pareados: sólo stock ──
    await escribirStock(
      tenantId,
      slugs,
      pareo.pares.map((p) => ({
        alegraId: p.principalAlegraId,
        itemIdCuenta: p.secundarioAlegraId,
        stock: porId.get(p.secundarioAlegraId)?.stock ?? null,
      })),
      runStart,
    )

    // ── 2) Solo-secundaria: fila propia + stock ──
    const listasPrincipal = await listasDeLaPrincipal(tenantId)
    const categoriasPrincipal = (
      await db
        .select({ alegraId: catalogCategories.alegraId, name: catalogCategories.name })
        .from(catalogCategories)
        .where(eq(catalogCategories.tenantId, tenantId))
    ).map((c) => ({ alegraId: c.alegraId, name: c.name }))

    const mapeados: { m: ItemSecundarioMapeado; adoptada: boolean; principalInactivaAlegraId: string | null }[] = []
    for (const s of pareo.soloSecundaria) {
      const item = porId.get(s.secundarioAlegraId)
      if (!item) continue
      mapeados.push({
        m: mapItemSecundario(item, cuenta, listasPrincipal, categorias, categoriasPrincipal),
        adoptada: s.principalInactivaAlegraId != null,
        principalInactivaAlegraId: s.principalInactivaAlegraId,
      })
    }

    // Adopción (O8): el stock de esta cuenta que estaba en la clave de la principal inactiva pasa a
    // la fila sintética (la de la principal queda en 0 y suelta el `item_id_cuenta`), y el overlay de
    // la principal se copia a la sintética si esta no tiene uno propio.
    const adoptadas = mapeados.filter((x) => x.adoptada && x.principalInactivaAlegraId)
    if (adoptadas.length > 0) {
      await db.execute(sql`
        UPDATE catalog_stock_sucursal
        SET stock = 0, item_id_cuenta = NULL, synced_at = now()
        WHERE tenant_id = ${tenantId}
          AND sucursal IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
          AND alegra_id IN (${sql.join(adoptadas.map((a) => sql`${a.principalInactivaAlegraId}`), sql`, `)})
          AND origen <> 'manual'
      `)
      for (const a of adoptadas) {
        await copiarOverlaySiFalta(db, tenantId, a.principalInactivaAlegraId as string, a.m.producto.alegraId)
      }
    }

    const filasSecundaria: ProductoSecundaria[] = mapeados.map(({ m, adoptada }) => ({
      producto: m.producto,
      alegraIdCuenta: m.alegraIdCuenta,
      estado: estadoSoloSecundaria(adoptada, m.producto.stock),
    }))
    await upsertProductosSecundaria(tenantId, cuenta.id, filasSecundaria, { leidoAt: runStart, leidoPor: "sync" })
    await escribirStock(
      tenantId,
      slugs,
      mapeados.map(({ m }) => ({ alegraId: m.producto.alegraId, itemIdCuenta: m.alegraIdCuenta, stock: m.producto.stock })),
      runStart,
    )

    // ── Guarda de corrida incompleta (base propia de esta cuenta) ──
    const guarda = evaluarCorrida({ items: items.length, categorias: categorias.length }, baseCorrida, opts)
    if (guarda.parcial) {
      console.warn(
        `[alegra-sync-cuenta] tenant=${tenantId} cuenta=${cuenta.slug} corrida=parcial items=${items.length} ` +
          `base=${baseCorrida?.items ?? "-"} motivo=${guarda.motivo}`,
      )
    }

    // ── 3) No vistos ──
    // Pareados no vistos: stock 0 (conservan `item_id_cuenta`). Solo-secundaria no vistos:
    // `inactive` + stock 0, acotado a ESTA cuenta. Sólo si la lectura no fue parcial.
    if (!guarda.parcialItems) {
      await db.execute(sql`
        UPDATE catalog_stock_sucursal
        SET stock = 0, synced_at = now()
        WHERE tenant_id = ${tenantId}
          AND sucursal IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
          AND synced_at < ${runStart.toISOString()}::timestamptz
          AND origen <> 'manual'
          AND stock <> 0
      `)
      await db.execute(sql`
        UPDATE catalog_products
        SET status = 'inactive', stock = 0
        WHERE tenant_id = ${tenantId}
          AND cuenta_id = ${cuenta.id}::uuid
          AND synced_at < ${runStart.toISOString()}::timestamptz
      `)
      await empujarNoVendiblesDeCuenta(tenantId, cuenta.id)
    }

    // ── Resumen ──
    const nombreDe = (alegraId: string) => porId.get(alegraId)?.name ?? ""
    const codigoDe = (alegraId: string) => porId.get(alegraId)?.code ?? null
    const listasSin = new Set<string>()
    let sinPrecio = 0
    let categoriasSin = 0
    for (const { m } of mapeados) {
      for (const l of m.listasSinEquivalente) listasSin.add(l)
      if (m.producto.prices.length === 0) sinPrecio++
      if (m.categoriaSinEquivalente) categoriasSin++
    }
    const sinCodigoSecundaria = pareo.sinCodigo.filter((x) => x.lado === "secundaria")
    const resumen: ResumenSync = {
      v: 1,
      cuenta: cuenta.slug,
      items: items.length,
      pareados: pareo.pares.length,
      soloSecundaria: mapeados.length,
      adoptados: adoptadas.length,
      sinCodigoPrincipal: pareo.sinCodigo.filter((x) => x.lado === "principal").length,
      duplicados: {
        total: pareo.duplicados.length,
        items: cortar(
          pareo.duplicados.map((d) => ({
            codigo: codigoDe(d.secundaria[0]) ?? d.clave,
            principal: d.principal,
            secundaria: d.secundaria.map((id) => ({ alegraId: id, codigo: codigoDe(id), nombre: nombreDe(id) })),
          })),
        ),
      },
      sinCodigo: {
        total: sinCodigoSecundaria.length,
        items: cortar(sinCodigoSecundaria.map((x) => ({ alegraId: x.alegraId, codigo: null, nombre: nombreDe(x.alegraId) }))),
      },
      listasSinEquivalente: [...listasSin].sort(),
      sinPrecio,
      categoriasSinEquivalente: categoriasSin,
    }

    await db
      .update(catalogSyncLog)
      .set({
        status: guarda.parcial ? "parcial" : "ok",
        itemsSynced: items.length,
        categoriesSynced: categorias.length,
        error: guarda.motivo,
        resumen,
        finishedAt: new Date(),
      })
      .where(eq(catalogSyncLog.id, logId))

    try {
      await avisarShop(tenantId)
    } catch (err) {
      console.warn(`[alegra-sync-cuenta] tenant=${tenantId} aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    }

    return {
      ok: true,
      cuenta: cuenta.slug,
      ...(guarda.parcial ? { parcial: true, motivo: guarda.motivo ?? undefined } : {}),
      itemsSynced: items.length,
      categoriesSynced: categorias.length,
      pareados: pareo.pares.length,
      soloSecundaria: mapeados.length,
      duplicados: pareo.duplicados.length,
      sinCodigo: sinCodigoSecundaria.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed"
    await db
      .update(catalogSyncLog)
      .set({ status: "error", error: message, finishedAt: new Date() })
      .where(eq(catalogSyncLog.id, logId))
    return fallo(message)
  }
}
