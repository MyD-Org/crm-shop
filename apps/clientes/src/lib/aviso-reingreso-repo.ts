/**
 * Consultas de `shop.avisos_reingreso` (migración 0043). SOLO servidor. Reciben el cliente `db` para
 * poder testear la forma del SQL con `dbGrabadora` y correrlas contra la DB local en integración.
 * Toda consulta lleva `tenant_id` (aislamiento por tenant).
 *
 * S1: alta idempotente y conteo de pendientes por email. S2: lo que usa el cron (pendientes por
 * producto, reclamar, marcar avisado o con error), la baja por token y la purga de retención.
 */
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { avisosReingreso as t } from "@/db/schema";
import { CLAIM_VENCE_MIN, MAX_INTENTOS, RETENCION_DIAS, RETENCION_PENDIENTES_DIAS } from "./aviso-reingreso-textos";

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

/**
 * Elegible para el cron: pendiente, con intentos por gastar y sin otro envío en curso (un claim de
 * más de `CLAIM_VENCE_MIN` minutos se da por muerto: la corrida que lo tomó se cortó).
 */
const sinReclamo = and(
  pendiente,
  sql`${t.intentos} < ${MAX_INTENTOS}`,
  or(isNull(t.avisandoEn), sql`${t.avisandoEn} < now() - make_interval(mins => ${CLAIM_VENCE_MIN})`),
);

/** Los `alegra_id` distintos con avisos por enviar en el tenant. Sin pendientes no hay nada que consultar. */
export async function pendientesAgrupados(db: Db, tenantId: string): Promise<string[]> {
  const filas = await db
    .selectDistinct({ alegraId: t.alegraId })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), sinReclamo))
    .orderBy(asc(t.alegraId));
  return filas.map((f) => f.alegraId);
}

export interface AvisoPendiente {
  id: string;
  alegraId: string;
  email: string;
  tokenBaja: string;
}

/** Hasta `limite` avisos por enviar de esos productos, los más viejos primero. */
export async function listarPendientesDe(
  db: Db,
  tenantId: string,
  alegraIds: string[],
  limite: number,
): Promise<AvisoPendiente[]> {
  if (alegraIds.length === 0 || limite <= 0) return [];
  return db
    .select({ id: t.id, alegraId: t.alegraId, email: t.email, tokenBaja: t.tokenBaja })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), inArray(t.alegraId, alegraIds), sinReclamo))
    .orderBy(asc(t.createdAt), asc(t.id))
    .limit(limite);
}

/**
 * Toma el aviso para enviarlo (anti doble envío entre corridas solapadas): un único UPDATE atómico.
 * Gasta un intento ya al reclamar, así una corrida que se corta a mitad también cuenta. `false` =
 * otro lo tiene, ya se avisó, se dio de baja o se agotaron los intentos.
 */
export async function reclamarAviso(db: Db, tenantId: string, id: string): Promise<boolean> {
  const filas = await db
    .update(t)
    .set({ avisandoEn: sql`now()`, intentos: sql`${t.intentos} + 1` })
    .where(and(eq(t.tenantId, tenantId), eq(t.id, id), sinReclamo))
    .returning({ id: t.id });
  return filas.length > 0;
}

/** El proveedor confirmó el envío: recién ahí se marca. Limpia el error y el reclamo. */
export async function marcarAvisado(db: Db, tenantId: string, id: string): Promise<void> {
  await db
    .update(t)
    .set({ avisadoAt: sql`now()`, emailError: null, avisandoEn: null })
    .where(and(eq(t.tenantId, tenantId), eq(t.id, id), isNull(t.avisadoAt)));
}

/**
 * El envío falló: guarda el motivo (sin datos personales) y libera el reclamo para reintentar en la
 * próxima corrida. Con `devolverIntento` (falta configurar el proveedor: no es culpa del aviso) no
 * gasta el intento. Nunca marca `avisado_at`.
 */
export async function marcarError(
  db: Db,
  tenantId: string,
  id: string,
  mensaje: string,
  opciones: { devolverIntento?: boolean } = {},
): Promise<void> {
  await db
    .update(t)
    .set({
      emailError: mensaje.slice(0, 200),
      avisandoEn: null,
      ...(opciones.devolverIntento ? { intentos: sql`greatest(${t.intentos} - 1, 0)` } : {}),
    })
    .where(and(eq(t.tenantId, tenantId), eq(t.id, id), isNull(t.avisadoAt)));
}

/**
 * Baja por token (sin sesión). Idempotente: una segunda baja deja la fecha de la primera. `false` =
 * el token no existe en este tenant (el llamador responde un mensaje neutro).
 */
export async function bajaPorToken(db: Db, tenantId: string, token: string): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const filas = await db
    .update(t)
    .set({ unsubscribedAt: sql`coalesce(${t.unsubscribedAt}, now())` })
    .where(and(eq(t.tenantId, tenantId), eq(t.tokenBaja, token)))
    .returning({ id: t.id });
  return filas.length > 0;
}

/**
 * Retención: borra (hay GRANT DELETE) los avisos ya enviados o dados de baja hace más de 180 días y los
 * pendientes sin atender hace más de 365. Un pendiente más nuevo nunca se toca. Devuelve cuántos borró.
 */
export async function purgar(db: Db, tenantId: string): Promise<number> {
  const hace = (dias: number) => sql`now() - make_interval(days => ${dias})`;
  const filas = await db
    .delete(t)
    .where(
      and(
        eq(t.tenantId, tenantId),
        or(
          lt(t.avisadoAt, hace(RETENCION_DIAS)),
          lt(t.unsubscribedAt, hace(RETENCION_DIAS)),
          and(pendiente, lt(t.createdAt, hace(RETENCION_PENDIENTES_DIAS))),
        ),
      ),
    )
    .returning({ id: t.id });
  return filas.length;
}
