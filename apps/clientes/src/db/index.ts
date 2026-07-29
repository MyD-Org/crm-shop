import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Singleton lazy del pool de conexiones.
 *
 * El pool DEBE reusarse: uno nuevo por request agota las conexiones de Postgres
 * (y con Neon en serverless, rápido). Va en `globalThis` porque en dev Next
 * re-evalúa los módulos en cada hot-reload — sin esto, cada guardado de archivo
 * dejaría un pool huérfano.
 *
 * Se guarda junto a la URL con la que se construyó: si cambia (típico al mover
 * el `.env.local` de la base local a Neon), se descarta y se reconecta. Sin eso
 * el pool viejo sobrevive al "Reload env" de Next y la app le sigue hablando en
 * silencio a la base anterior.
 */
const globalForDb = globalThis as unknown as {
  shopDb?: { db: ReturnType<typeof buildDb>; url: string };
};

/**
 * Connection string. Se acepta `POSTGRES_URL` además de `DATABASE_URL` porque
 * es el nombre que inyecta la integración Neon/Vercel: si solo leyéramos
 * `DATABASE_URL`, en producción habría que duplicar la variable a mano y el
 * olvido se descubre recién en runtime.
 */
export function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL (o POSTGRES_URL) en el entorno. Revisar .env.local."
    );
  }
  return url;
}

function buildDb(url: string) {
  // `prepare: false` para compatibilidad con el pooler de Neon (pgbouncer).
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

export function getDb() {
  const url = connectionString();
  const cache = globalForDb.shopDb;

  // Se valida `cache.db` y no solo `cache`: en dev el hot-reload puede dejar en
  // globalThis un valor guardado por una versión anterior de este módulo, con
  // otra forma. Confiar en que el global tiene la forma actual rompe al primer
  // cambio de este archivo.
  if (cache?.db && cache.url === url) return cache.db;

  if (cache) {
    console.warn("[db] connection string nueva o cache obsoleta: reconectando");
    // No se espera el cierre: las queries en vuelo terminan contra el pool viejo
    // y el nuevo ya queda disponible. Es un caso de dev, no de producción.
    // Encadenado con `?.` porque el pool viejo puede no tener esta forma.
    void cache.db?.$client?.end({ timeout: 5 })?.catch(() => {});
  }

  globalForDb.shopDb = { db: buildDb(url), url };
  return globalForDb.shopDb.db;
}

export type Db = ReturnType<typeof getDb>;
