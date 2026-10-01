/**
 * Lecturas del banco en vivo, SIEMPRE en una transacción de solo lectura.
 * SOLO scripts (`npm run banco:*`), nunca la app.
 *
 * Las funciones del catálogo (`getPaginaCatalogo`, `getArbolCategorias`…)
 * toman la base de `getDb()`, que guarda el pool en `globalThis.shopDb`. Para
 * que corran dentro de la transacción sin tocarlas, durante `fn` ese global
 * apunta a la transacción (misma URL, así `getDb()` la devuelve). Una
 * transacción por búsqueda: si una consulta falla (p. ej. falta pg_trgm), sólo
 * esa búsqueda se pierde.
 *
 * Postgres rechaza cualquier escritura en una transacción `read only`: es la
 * garantía de que el banco no modifica nada (tampoco la caché de planes).
 */
import { getDb } from "@/db";

type GlobalDb = { shopDb?: { db: unknown; url: string } };

export async function enLectura<T>(fn: () => Promise<T>): Promise<T> {
  const db = getDb();
  const g = globalThis as unknown as GlobalDb;
  const original = g.shopDb!;
  return db.transaction(
    async (tx) => {
      g.shopDb = { db: tx, url: original.url };
      try {
        return await fn();
      } finally {
        g.shopDb = original;
      }
    },
    { accessMode: "read only" },
  );
}

/** Cierra el pool para que el script termine. */
export async function cerrar(): Promise<void> {
  await getDb().$client.end({ timeout: 5 });
}
