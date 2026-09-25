import { and, eq, lt, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogCategories, catalogProducts, catalogSyncLog } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import { listAllCategories, listAllItems } from "./alegra"
import { upsertProductos } from "./catalog-products-repo"
import { baseDeCorrida, evaluarCorrida } from "./alegra-sync-guarda"
import { avisarShop } from "./aviso-shop"

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

export async function syncCatalog(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { aceptarBaja?: boolean } = {},
): Promise<SyncResult> {
  const db = getDb()
  // La base se toma ANTES de abrir el log de esta corrida.
  const base = await baseDeCorrida(config.id)
  const runStart = new Date()
  const [log] = await db
    .insert(catalogSyncLog)
    .values({ tenantId: config.id, trigger, status: "running", startedAt: runStart })
    .returning({ id: catalogSyncLog.id })

  try {
    // ── Categorías ──
    const categories = await listAllCategories(config)
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

    // ── Productos ──
    // `leidoAt = runStart`: cota inferior de cuándo se leyó cada página. Un webhook que re-leyó
    // un ítem después del arranque tiene un dato más fresco y la sync no lo pisa (ver
    // lib/catalog-products-repo.ts).
    const items = await listAllItems(config)
    await upsertProductos(config.id, items, { leidoAt: runStart, leidoPor: "sync" })

    const guarda = evaluarCorrida({ items: items.length, categorias: categories.length }, base, opts)
    if (guarda.parcial) {
      console.warn(
        `[alegra-sync] tenant=${config.id} corrida=parcial items=${items.length} base=${base?.items ?? "-"} ` +
          `categorias=${categories.length} baseCategorias=${base?.categorias ?? "-"} motivo=${guarda.motivo}`,
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
        .where(and(eq(catalogProducts.tenantId, config.id), lt(catalogProducts.syncedAt, runStart)))
    }
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
        itemsSynced: items.length,
        categoriesSynced: categories.length,
        error: guarda.motivo,
        finishedAt: new Date(),
      })
      .where(eq(catalogSyncLog.id, log.id))

    // Dentro del try pero blindado: un fallo acá no puede convertir una sync OK en 'error'.
    try {
      await avisarShop(config.id)
    } catch (err) {
      console.warn(`[alegra-sync] tenant=${config.id} aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    }

    return guarda.parcial
      ? { ok: true, parcial: true, motivo: guarda.motivo ?? undefined, itemsSynced: items.length, categoriesSynced: categories.length }
      : { ok: true, itemsSynced: items.length, categoriesSynced: categories.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed"
    await db
      .update(catalogSyncLog)
      .set({ status: "error", error: message, finishedAt: new Date() })
      .where(eq(catalogSyncLog.id, log.id))
    return { ok: false, itemsSynced: 0, categoriesSynced: 0, error: message }
  }
}
