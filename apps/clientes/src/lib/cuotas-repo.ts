/**
 * Persistencia de la sync de cuotas en la DB del Shop (Drizzle). SOLO servidor.
 *
 * Es plomería fina: la semántica (última copia buena, lock, independencia de
 * fuentes) vive y se testea en `cuotas-sync.ts`. El lock es un UPDATE
 * condicional sobre `last_attempt_at` con RETURNING: si otra corrida lo tomó
 * hace menos de 5 min, no devuelve filas y esta corrida no consulta.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentConfigCache, paymentPlanSnapshots } from "@/db/schema";
import type { RepoCuotas } from "./cuotas-sync";

export const repoCuotasDrizzle: RepoCuotas = {
  async tomarLockConfig(tenant, ahora, vencidoAntesDe) {
    const db = getDb();
    await db.insert(paymentConfigCache).values({ tenant }).onConflictDoNothing();
    const filas = await db
      .update(paymentConfigCache)
      .set({ lastAttemptAt: ahora })
      .where(
        and(
          eq(paymentConfigCache.tenant, tenant),
          vencidoAntesDe
            ? or(isNull(paymentConfigCache.lastAttemptAt), lt(paymentConfigCache.lastAttemptAt, vencidoAntesDe))
            : undefined,
        ),
      )
      .returning({ tenant: paymentConfigCache.tenant });
    return filas.length > 0;
  },

  async guardarConfig(tenant, payload, ahora) {
    await getDb()
      .update(paymentConfigCache)
      .set({ payload, version: payload.version, fetchedAt: ahora, lastError: null })
      .where(eq(paymentConfigCache.tenant, tenant));
  },

  async errorConfig(tenant, error) {
    await getDb()
      .update(paymentConfigCache)
      .set({ lastError: error.slice(0, 1000) })
      .where(eq(paymentConfigCache.tenant, tenant));
  },

  async leerConfig(tenant) {
    const [fila] = await getDb()
      .select({ payload: paymentConfigCache.payload, fetchedAt: paymentConfigCache.fetchedAt })
      .from(paymentConfigCache)
      .where(eq(paymentConfigCache.tenant, tenant))
      .limit(1);
    return fila ?? null;
  },

  async tomarLockPlanes(proveedor, medios, ahora, vencidoAntesDe) {
    if (medios.length === 0) return [];
    const db = getDb();
    await db
      .insert(paymentPlanSnapshots)
      .values(medios.map((medio) => ({ proveedor, medio })))
      .onConflictDoNothing();
    const filas = await db
      .update(paymentPlanSnapshots)
      .set({ lastAttemptAt: ahora })
      .where(
        and(
          eq(paymentPlanSnapshots.proveedor, proveedor),
          inArray(paymentPlanSnapshots.medio, medios),
          vencidoAntesDe
            ? or(isNull(paymentPlanSnapshots.lastAttemptAt), lt(paymentPlanSnapshots.lastAttemptAt, vencidoAntesDe))
            : undefined,
        ),
      )
      .returning({ medio: paymentPlanSnapshots.medio });
    return filas.map((f) => f.medio);
  },

  async guardarPlanes(proveedor, medio, planes, ahora) {
    await getDb()
      .update(paymentPlanSnapshots)
      .set({ planes, fetchedAt: ahora, lastError: null })
      .where(and(eq(paymentPlanSnapshots.proveedor, proveedor), eq(paymentPlanSnapshots.medio, medio)));
  },

  async errorPlanes(proveedor, medio, error) {
    await getDb()
      .update(paymentPlanSnapshots)
      .set({ lastError: error.slice(0, 1000) })
      .where(and(eq(paymentPlanSnapshots.proveedor, proveedor), eq(paymentPlanSnapshots.medio, medio)));
  },

  async leerPlanes() {
    return getDb()
      .select({
        proveedor: paymentPlanSnapshots.proveedor,
        medio: paymentPlanSnapshots.medio,
        planes: paymentPlanSnapshots.planes,
        fetchedAt: paymentPlanSnapshots.fetchedAt,
      })
      .from(paymentPlanSnapshots);
  },
};
