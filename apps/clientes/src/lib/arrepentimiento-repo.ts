/**
 * Consultas de `shop.solicitudes_arrepentimiento` (migración 0016). SOLO
 * servidor. Reciben el cliente `db` para poder testear la forma del SQL con
 * `dbGrabadora`; la server action les pasa `getDb()`.
 */
import { and, count, eq, gte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { solicitudesArrepentimiento as t } from "@/db/schema";

/** Cualquier cliente Postgres de drizzle: `getDb()` en runtime, `dbGrabadora` en tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, any>;

/** Solicitudes del mismo email (ya normalizado) en el tenant desde `desde`. */
export async function contarRecientesPorEmail(db: Db, tenantId: string, email: string, desde: Date): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), eq(t.email, email), gte(t.createdAt, desde)));
  return Number(fila?.n ?? 0);
}

export interface FilaSolicitud {
  tenantId: string;
  nombre: string;
  email: string;
  telefono: string;
  pedidoNumero: string | null;
  motivo: string | null;
}

/** Guarda la solicitud (sin IP ni user agent) y devuelve el número del código. */
export async function insertarSolicitud(db: Db, fila: FilaSolicitud): Promise<{ id: string; numero: number }> {
  const [r] = await db.insert(t).values(fila).returning({ id: t.id, numero: t.numero });
  if (!r) throw new Error("El insert de la solicitud no devolvió fila");
  return r;
}

/** Resultado de los avisos por mail. */
export async function marcarEnvios(
  db: Db,
  id: string,
  r: { clienteEn: Date | null; comercioEn: Date | null; error: string | null },
): Promise<void> {
  await db
    .update(t)
    .set({ emailClienteEnviadoEn: r.clienteEn, emailComercioEnviadoEn: r.comercioEn, emailError: r.error })
    .where(eq(t.id, id));
}
