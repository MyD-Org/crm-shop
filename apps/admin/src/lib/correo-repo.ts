import { and, eq, inArray, lt, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { correoCasillas, correoEventos, correoHilos } from "@/db/schema"
import type { CorreoCarpeta } from "./correo-resend"

// SQL del espejo mínimo del correo (casillas, hilos, idempotencia del webhook). Sin red: Resend
// vive en lib/correo-resend.ts. Acá no se guarda ningún cuerpo, asunto ni remitente.

export type CasillaRow = typeof correoCasillas.$inferSelect
export type HiloEspejoRow = typeof correoHilos.$inferSelect

/**
 * Alta o refresco de una casilla por (tenant, resend_inbox_id). Si ya existe NO pisa `nombre`,
 * `activa` ni `orden` (los edita el admin): solo refresca el email. Una inbox que ya pertenece
 * a OTRO tenant no se toca (devuelve null): `resend_inbox_id` es único global.
 */
export async function upsertCasilla(
  tenantId: string,
  datos: { resendInboxId: string; email: string; nombre?: string; activa?: boolean; orden?: number },
): Promise<CasillaRow | null> {
  const db = getDb()
  const [fila] = await db
    .insert(correoCasillas)
    .values({
      tenantId,
      resendInboxId: datos.resendInboxId,
      email: datos.email,
      nombre: datos.nombre || datos.email,
      activa: datos.activa ?? true,
      orden: datos.orden ?? 0,
    })
    .onConflictDoUpdate({
      target: correoCasillas.resendInboxId,
      set: { email: datos.email },
      setWhere: eq(correoCasillas.tenantId, tenantId),
    })
    .returning()
  return fila ?? null
}

/** Casilla por inbox de Resend (la resuelve el webhook, sin tenant en la URL). */
export async function casillaPorInbox(resendInboxId: string): Promise<CasillaRow | null> {
  const [fila] = await getDb().select().from(correoCasillas).where(eq(correoCasillas.resendInboxId, resendInboxId)).limit(1)
  return fila ?? null
}

/**
 * Upsert del espejo de un hilo. No duplica por (casilla, thread) y `ultimo_evento_at` nunca
 * retrocede (eventos fuera de orden). `leido`/`folder` solo se tocan si vienen informados, y un
 * evento más viejo que el último visto no pisa el estado.
 */
export async function upsertHilo(
  casillaId: string,
  resendThreadId: string,
  datos: { folder?: CorreoCarpeta; leido?: boolean; eventoAt?: Date } = {},
): Promise<HiloEspejoRow> {
  const eventoAt = datos.eventoAt ?? new Date()
  const evIso = sql`${eventoAt.toISOString()}::timestamptz`
  const [fila] = await getDb()
    .insert(correoHilos)
    .values({
      casillaId,
      resendThreadId,
      folder: datos.folder ?? "inbox",
      leido: datos.leido ?? false,
      ultimoEventoAt: eventoAt,
    })
    .onConflictDoUpdate({
      target: [correoHilos.casillaId, correoHilos.resendThreadId],
      set: {
        ultimoEventoAt: sql`GREATEST(${correoHilos.ultimoEventoAt}, ${evIso})`,
        ...(datos.folder
          ? { folder: sql`CASE WHEN ${evIso} >= ${correoHilos.ultimoEventoAt} THEN ${datos.folder} ELSE ${correoHilos.folder} END` }
          : {}),
        ...(datos.leido !== undefined
          ? { leido: sql`CASE WHEN ${evIso} >= ${correoHilos.ultimoEventoAt} THEN ${datos.leido} ELSE ${correoHilos.leido} END` }
          : {}),
      },
    })
    .returning()
  return fila
}

/** Registra un evento del webhook. true = es nuevo; false = ya se había procesado (replay). */
export async function registrarEvento(svixId: string): Promise<boolean> {
  const filas = await getDb()
    .insert(correoEventos)
    .values({ svixId })
    .onConflictDoNothing()
    .returning({ svixId: correoEventos.svixId })
  return filas.length > 0
}

/** Deshace el registro cuando el procesamiento falla, para que el reintento de Resend sí corra. */
export async function borrarEvento(svixId: string): Promise<void> {
  await getDb().delete(correoEventos).where(eq(correoEventos.svixId, svixId))
}

/** Limpieza oportunista de eventos viejos. Devuelve cuántos borró. */
export async function limpiarEventosViejos(dias = 30, ahora = new Date()): Promise<number> {
  const corte = new Date(ahora.getTime() - dias * 86_400_000)
  const filas = await getDb().delete(correoEventos).where(lt(correoEventos.recibidoAt, corte)).returning({ s: correoEventos.svixId })
  return filas.length
}

/** Hilos sin leer en Recibidos de las casillas dadas (el badge). Una sola query. */
export async function contarNoLeidos(casillaIds: string[]): Promise<number> {
  if (casillaIds.length === 0) return 0
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(correoHilos)
    .where(and(inArray(correoHilos.casillaId, casillaIds), eq(correoHilos.folder, "inbox"), eq(correoHilos.leido, false)))
  return r?.n ?? 0
}
