/**
 * Sincroniza el catálogo de Alegra al espejo local (src/db/schema.ts).
 *
 * Upsert por `alegraId`; lo que no se vio en la corrida queda `inactive` (baja
 * lógica, nunca DELETE). Deja bitácora en `catalog_sync_log`.
 *
 * SOLO servidor, y solo desde el cron o un disparo manual: recorre ~2800 items
 * paginando de a 30 contra Alegra. Ver docs/arquitectura-integraciones.md.
 */

import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogCategories, catalogProducts, catalogSyncLog } from "@/db/schema";
import { listAllCategories, listAllItems } from "./alegra";

/** Filas por INSERT. Con ~2800 items son ~6 statements, sin pasarse de límites de parámetros. */
const CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface SyncResult {
  ok: boolean;
  itemsSynced: number;
  categoriesSynced: number;
  error?: string;
}

export async function syncCatalog(
  trigger: "cron" | "manual"
): Promise<SyncResult> {
  const db = getDb();
  const runStart = new Date();
  const [log] = await db
    .insert(catalogSyncLog)
    .values({ trigger, status: "running", startedAt: runStart })
    .returning({ id: catalogSyncLog.id });

  try {
    // ── Categorías ──
    const categories = await listAllCategories();
    for (const batch of chunk(categories, CHUNK)) {
      await db
        .insert(catalogCategories)
        .values(
          batch.map((c) => ({
            alegraId: c.alegraId,
            name: c.name,
            parentAlegraId: c.parentAlegraId,
            status: c.status === "inactive" ? "inactive" : "active",
            syncedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: catalogCategories.alegraId,
          set: {
            name: sql`excluded.name`,
            parentAlegraId: sql`excluded.parent_alegra_id`,
            status: sql`excluded.status`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }

    // ── Productos ──
    const items = await listAllItems();
    for (const batch of chunk(items, CHUNK)) {
      await db
        .insert(catalogProducts)
        .values(
          batch.map((it) => ({
            alegraId: it.alegraId,
            code: it.code,
            name: it.name,
            description: it.description,
            categoryAlegraId: it.categoryAlegraId,
            brand: it.brand,
            prices: it.prices,
            stock: it.stock != null ? String(it.stock) : null,
            status: it.status === "inactive" ? "inactive" : "active",
            syncedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: catalogProducts.alegraId,
          set: {
            code: sql`excluded.code`,
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            categoryAlegraId: sql`excluded.category_alegra_id`,
            brand: sql`excluded.brand`,
            prices: sql`excluded.prices`,
            stock: sql`excluded.stock`,
            status: sql`excluded.status`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }

    // ── Stale ──
    // Lo que no tocó esta corrida (syncedAt anterior al arranque) desapareció de
    // Alegra: se marca inactive. Solo se llega acá si la corrida completó OK, así
    // que un fallo a mitad de camino nunca da de baja medio catálogo.
    await db
      .update(catalogProducts)
      .set({ status: "inactive" })
      .where(lt(catalogProducts.syncedAt, runStart));
    await db
      .update(catalogCategories)
      .set({ status: "inactive" })
      .where(lt(catalogCategories.syncedAt, runStart));

    await db
      .update(catalogSyncLog)
      .set({
        status: "ok",
        itemsSynced: items.length,
        categoriesSynced: categories.length,
        finishedAt: new Date(),
      })
      .where(sql`${catalogSyncLog.id} = ${log.id}`);

    return {
      ok: true,
      itemsSynced: items.length,
      categoriesSynced: categories.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    await db
      .update(catalogSyncLog)
      .set({ status: "error", error: message, finishedAt: new Date() })
      .where(sql`${catalogSyncLog.id} = ${log.id}`);
    return { ok: false, itemsSynced: 0, categoriesSynced: 0, error: message };
  }
}
