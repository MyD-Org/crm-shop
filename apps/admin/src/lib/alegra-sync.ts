import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogCategories, catalogProducts, catalogSyncLog } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import { listAllCategories, listItemsLote } from "./alegra"
import { upsertProductos } from "./catalog-products-repo"
import { abrirCorrida, baseDeCorrida, evaluarCorrida, MSG_SYNC_EN_CURSO, type Conteo } from "./alegra-sync-guarda"
import { absorberSoloSecundaria, escribirStockPrincipal } from "./catalogo-union-repo"
import { avisarShop } from "./aviso-shop"
import { sincronizarAtributosDeNombre } from "./catalogo-atributos-repo"

// Sincroniza el catálogo de Alegra a la cache local (upsert por alegraId). Lo que no se ve en la
// corrida se marca 'inactive' (stale), solo si el run completó OK. Deja bitácora en catalog_sync_log.
// Ver ADR catálogo Alegra (cache + live).
//
// Guarda (lib/alegra-sync-guarda.ts): el catálogo del Shop sale de acá, así que una corrida que
// leyó sensiblemente menos que la última OK del tenant (o 0 ítems) upsertea lo leído pero NO
// empuja el overlay ni marca stale, y queda 'parcial' en catalog_sync_log (con el motivo). Para
// aceptar una baja masiva legítima: `opts.aceptarBaja` (sólo desde el workflow, con tenant).
// Estados del log: 'running' | 'ok' | 'parcial' | 'error'.
//
// Catálogo unión (change `sucursales-igz-mdp`, rebanada D): esta es la sync de la cuenta PRINCIPAL.
// `catalog_products.stock` de sus filas = stock de la principal. El "stale" y la baja de ítems
// se acotan a `cuenta_id IS NULL`: las filas solo-secundaria (de otra cuenta) las administra la
// sync de su cuenta (`alegra-sync-cuenta.ts`) y la de la principal NO debe darlas de baja. Al
// final escribe el stock de la principal en `catalog_stock_sucursal` (para las sucursales que
// usan su cuenta) y corre la absorción: un código que era solo-secundaria y ahora existe (o se
// reactivó) en la principal pasa a mandar la principal.
//
// Por tramos: la lectura de ~18 000 ítems tarda ~5 min (150 req/min de Alegra) y no entra en una
// invocación. `syncCatalogTramo` lee lotes de páginas hasta agotar el presupuesto de tiempo y
// devuelve un cursor (offset de lectura + corrida abierta); la siguiente invocación retoma de ahí.
// El stale, las bajas, la absorción y el cierre del log corren SÓLO cuando la pasada completa
// terminó, nunca con una pasada parcial. `syncCatalog` es la versión de una sola pasada.
//
// Al terminar bien (también 'parcial': lo leído ya se upserteó) avisa al Shop para que descarte
// su caché del catálogo (lib/aviso-shop.ts). El aviso es best-effort: si el Shop no responde, la
// sync ya quedó y su resultado no cambia.

const CHUNK = 500

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface SyncResult {
  ok: boolean
  /** La corrida leyó demasiado poco: no se dio de baja nada (ver la guarda). */
  parcial?: boolean
  /** Sólo números, p. ej. "items 5400 < base 11795 (umbral 95 %)". */
  motivo?: string
  itemsSynced: number
  categoriesSynced: number
  error?: string
}

/** Estado de una pasada de la principal a medias (viaja dentro del cursor del tenant). */
export interface CursorPrincipal {
  logId: string
  /** ISO: arranque de la corrida (cota de "visto en esta corrida" para el stale). */
  runStart: string
  /** Offset del próximo lote de ítems a leer. */
  start: number
  /** Ítems leídos hasta ahora. */
  items: number
  categorias: number
  /** Conteo de la última corrida OK (para la guarda y para mostrar "N de ~M"). */
  base: Conteo | null
}

export type TramoPrincipal = { fin: false; cursor: CursorPrincipal } | { fin: true; result: SyncResult }

export interface ControlTramo {
  /** Epoch ms a partir del cual se corta (se chequea entre lotes). */
  deadline: number
  /** Se llama tras cada lote con el cursor vigente (para persistirlo). */
  onProgreso?: (c: CursorPrincipal) => Promise<void>
}

/**
 * Un tramo de la sync de la cuenta principal: si `cursor` es null abre la corrida, sincroniza las
 * categorías y empieza a leer ítems; si no, retoma desde `cursor.start`. Lee hasta agotar el
 * presupuesto (`ctl.deadline`) y, si no terminó, devuelve el cursor. Al terminar la lectura corre
 * el cierre (stale, absorción, log).
 */
export async function syncCatalogTramo(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { aceptarBaja?: boolean },
  cursor: CursorPrincipal | null,
  ctl: ControlTramo,
): Promise<TramoPrincipal> {
  const db = getDb()
  let cur: CursorPrincipal
  let categories: Awaited<ReturnType<typeof listAllCategories>> = []

  if (cursor) {
    cur = cursor
  } else {
    // La base se toma ANTES de abrir el log de esta corrida.
    const base = await baseDeCorrida(config.id)
    const runStart = new Date()
    // Guarda de concurrencia: una sola corrida a la vez de la cuenta principal del tenant.
    const logId = await abrirCorrida(config.id, null, trigger, runStart)
    if (!logId) return { fin: true, result: { ok: false, itemsSynced: 0, categoriesSynced: 0, error: MSG_SYNC_EN_CURSO } }
    cur = { logId, runStart: runStart.toISOString(), start: 0, items: 0, categorias: 0, base }
  }
  const runStart = new Date(cur.runStart)
  const logId = cur.logId

  try {
    if (!cursor) {
      // ── Categorías ── (chicas: van completas en el primer tramo)
      categories = await listAllCategories(config)
      cur.categorias = categories.length
      for (const batch of chunk(categories, CHUNK)) {
        await db
          .insert(catalogCategories)
          .values(
            batch.map((c) => ({
              tenantId: config.id,
              alegraId: c.alegraId,
              name: c.name,
              parentAlegraId: c.parentAlegraId,
              status: "active",
              syncedAt: new Date(),
            })),
          )
          .onConflictDoUpdate({
            target: [catalogCategories.tenantId, catalogCategories.alegraId],
            set: {
              name: sql`excluded.name`,
              parentAlegraId: sql`excluded.parent_alegra_id`,
              status: sql`excluded.status`,
              syncedAt: sql`excluded.synced_at`,
            },
          })
      }
    }

    // ── Productos ── por lotes, hasta terminar o quedarse sin presupuesto.
    // `leidoAt = runStart`: cota inferior de cuándo se leyó cada página. Un webhook que re-leyó
    // un ítem después del arranque tiene un dato más fresco y la sync no lo pisa (ver
    // lib/catalog-products-repo.ts).
    for (;;) {
      const lote = await listItemsLote(config, cur.start)
      await upsertProductos(config.id, lote.items, { leidoAt: runStart, leidoPor: "sync" })
      // Atributos técnicos del nombre (potencia, kelvin, zócalo…) → catalog_atributos, fuente
      // 'nombre'. Tolerante: si falla (p. ej. la migración 0048 sin aplicar) la sync sigue igual.
      await sincronizarAtributosDeNombre(config.id, lote.items, "sync")
      cur.items += lote.items.length
      cur.start = lote.siguiente
      await db
        .update(catalogSyncLog)
        .set({ itemsSynced: cur.items, categoriesSynced: cur.categorias, actividadAt: new Date() })
        .where(eq(catalogSyncLog.id, logId))
      if (lote.fin) break
      if (ctl.onProgreso) await ctl.onProgreso(cur)
      if (Date.now() >= ctl.deadline) return { fin: false, cursor: cur }
    }

    // ── La pasada completa terminó: recién ahora bajas / stale / absorción / cierre ──
    return { fin: true, result: await cerrarPasada(config, opts, cur, runStart) }
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed"
    await db
      .update(catalogSyncLog)
      .set({ status: "error", error: message, finishedAt: new Date() })
      .where(eq(catalogSyncLog.id, logId))
    return { fin: true, result: { ok: false, itemsSynced: 0, categoriesSynced: 0, error: message } }
  }
}

async function cerrarPasada(
  config: TenantConfig,
  opts: { aceptarBaja?: boolean },
  cur: CursorPrincipal,
  runStart: Date,
): Promise<SyncResult> {
  const db = getDb()
  const itemsLeidos = cur.items
  const categoriasLeidas = cur.categorias
  const log = { id: cur.logId }

  // Stock de la principal por sucursal (para las sucursales que usan su cuenta).
  await escribirStockPrincipal(config.id)

  const guarda = evaluarCorrida({ items: itemsLeidos, categorias: categoriasLeidas }, cur.base, opts)
  if (guarda.parcial) {
    console.warn(
      `[alegra-sync] tenant=${config.id} corrida=parcial items=${itemsLeidos} base=${cur.base?.items ?? "-"} ` +
        `categorias=${categoriasLeidas} baseCategorias=${cur.base?.categorias ?? "-"} motivo=${guarda.motivo}`,
    )
  }
  if (opts.aceptarBaja) console.info(`[alegra-sync] tenant=${config.id} aceptarBaja=1`)

  // ── Empujar al Shop los que dejaron de ser vendibles ──
  //
  // El delta hacia el Shop se mueve por `catalog_overlay.updated_at`, que sólo cambia cuando
  // alguien edita en el panel. Sin esto, un producto que Alegra dio de baja (o que quedó en
  // precio cero) seguiría publicado en la tienda para siempre: su fila del overlay no se tocó,
  // así que el delta nunca lo volvería a mandar. Se le corre la marca de tiempo para que viaje
  // una vez más, ya como visible:false. Con una lectura parcial de productos NO se corre.
  if (!guarda.parcialItems) await db.execute(sql`
    UPDATE catalog_overlay o
    SET updated_at = now()
    FROM catalog_products p
    WHERE o.tenant_id = ${config.id}
      AND p.tenant_id = o.tenant_id
      AND p.alegra_id = o.alegra_id
      AND o.visible = true
      AND NOT (
        p.status = 'active'
        AND (p.alegra_status IS NULL OR p.alegra_status <> 'inactive')
        AND coalesce((
          SELECT max((elem->>'price')::numeric)
          FROM jsonb_array_elements(p.prices) elem
          WHERE jsonb_typeof(p.prices) = 'array'
        ), 0) > 0
      )
  `)

  // ── Stale: lo no visto en esta corrida queda inactive (no se borra, soft) ──
  // Cada uno sólo si su lectura no fue parcial.
  if (!guarda.parcialItems) {
    await db
      .update(catalogProducts)
      .set({ status: "inactive" })
      // Sólo la principal: las filas solo-secundaria (`cuenta_id` no nulo) no se ven acá.
      .where(and(eq(catalogProducts.tenantId, config.id), isNull(catalogProducts.cuentaId), lt(catalogProducts.syncedAt, runStart)))
  }
  // Absorción: DESPUÉS del stale, para decidir con el estado final de la principal (un ítem que
  // acaba de darse de baja no absorbe a su par solo-secundaria).
  await absorberSoloSecundaria(config.id)

  if (!guarda.parcialCategorias) {
    await db
      .update(catalogCategories)
      .set({ status: "inactive" })
      .where(and(eq(catalogCategories.tenantId, config.id), lt(catalogCategories.syncedAt, runStart)))
  }

  await db
    .update(catalogSyncLog)
    .set({
      status: guarda.parcial ? "parcial" : "ok",
      itemsSynced: itemsLeidos,
      categoriesSynced: categoriasLeidas,
      error: guarda.motivo,
      finishedAt: new Date(),
    })
    .where(eq(catalogSyncLog.id, log.id))

  // Blindado: un fallo acá no puede convertir una sync OK en 'error'.
  try {
    await avisarShop(config.id)
  } catch (err) {
    console.warn(`[alegra-sync] tenant=${config.id} aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
  }

  return guarda.parcial
    ? { ok: true, parcial: true, motivo: guarda.motivo ?? undefined, itemsSynced: itemsLeidos, categoriesSynced: categoriasLeidas }
    : { ok: true, itemsSynced: itemsLeidos, categoriesSynced: categoriasLeidas }
}

/** Sync de la principal en UNA pasada (sin presupuesto): lo que usan los tests y las herramientas. */
export async function syncCatalog(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { aceptarBaja?: boolean } = {},
): Promise<SyncResult> {
  const t = await syncCatalogTramo(config, trigger, opts, null, { deadline: Number.POSITIVE_INFINITY })
  // Sin presupuesto no puede quedar a medias.
  return t.fin ? t.result : { ok: false, itemsSynced: 0, categoriesSynced: 0, error: "sync_incompleta" }
}
