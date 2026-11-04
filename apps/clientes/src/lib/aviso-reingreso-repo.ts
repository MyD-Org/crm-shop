/**
 * Consultas de `shop.avisos_reingreso` (migración 0043). SOLO servidor. Reciben el cliente `db` para
 * poder testear la forma del SQL con `dbGrabadora` y correrlas contra la DB local en integración.
 * Toda consulta lleva `tenant_id` (aislamiento por tenant).
 *
 * Rebanada S1: alta idempotente y conteo de pendientes por email. El cron, la baja y la purga
 * (reclamar, marcar, purgar) llegan en la rebanada S2.
 */
import { randomBytes } from "node:crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { avisosReingreso as t } from "@/db/schema";

/** Cualquier cliente Postgres de drizzle: `getDb()` en runtime, `dbGrabadora` en tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, any>;

/** Token de baja: 32 bytes aleatorios en base64url (no adivinable). */
export function generarTokenBaja(): string {
  return randomBytes(32).toString("base64url");
}

/** Pendiente = ni avisado ni dado de baja (mismo predicado que los índices parciales). */
const pendiente = and(isNull(t.avisadoAt), isNull(t.unsubscribedAt));

/** Avisos pendientes del email (ya normalizado) en el tenant, de cualquier producto. */
export async function contarPendientesPorEmail(db: Db, tenantId: string, email: string): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), sql`lower(${t.email}) = ${email.toLowerCase()}`, pendiente));
  return Number(fila?.n ?? 0);
}

export interface FilaAviso {
  tenantId: string;
  alegraId: string;
  /** Normalizado: trim + minúsculas. */
  email: string;
  whatsapp: string | null;
  cantidad: number;
  quiereEncargar: boolean;
  consentimientoContacto: boolean;
  clerkUserId: string | null;
}

/**
 * Guarda el aviso. Si ya hay uno PENDIENTE del mismo (tenant, producto, email sin importar
 * mayúsculas), no crea otra fila: actualiza la cantidad y el "encargar" de la pendiente (y el
 * WhatsApp solo si llega uno; nunca lo borra). Tras avisar o dar de baja, la misma persona puede
 * pedir de nuevo y se crea una fila nueva. Sin IP ni user agent. Devuelve si la fila es nueva.
 */
export async function insertarAviso(db: Db, fila: FilaAviso): Promise<{ id: string; creado: boolean }> {
  const token = generarTokenBaja();
  const filas = (await db.execute(sql`
    insert into "shop"."avisos_reingreso"
      ("tenant_id", "alegra_id", "email", "whatsapp", "cantidad", "quiere_encargar", "consentimiento_contacto", "clerk_user_id", "token_baja")
    values
      (${fila.tenantId}, ${fila.alegraId}, ${fila.email}, ${fila.whatsapp}, ${fila.cantidad}, ${fila.quiereEncargar}, ${fila.consentimientoContacto}, ${fila.clerkUserId}, ${token})
    on conflict ("tenant_id", "alegra_id", lower("email")) where "avisado_at" is null and "unsubscribed_at" is null
    do update set
      "cantidad" = excluded."cantidad",
      "quiere_encargar" = excluded."quiere_encargar",
      "whatsapp" = coalesce(excluded."whatsapp", "avisos_reingreso"."whatsapp"),
      "consentimiento_contacto" = ("avisos_reingreso"."consentimiento_contacto" or excluded."consentimiento_contacto")
    returning "id", (xmax = 0) as "creado"
  `)) as unknown as { id: string; creado: boolean }[];
  const r = Array.isArray(filas) ? filas[0] : undefined;
  if (!r) throw new Error("El insert del aviso no devolvió fila");
  return { id: r.id, creado: r.creado === true };
}
