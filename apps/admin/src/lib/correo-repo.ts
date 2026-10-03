import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, correoCasillaAccesos, correoCasillas, correoEventos, correoHilos } from "@/db/schema"
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

/**
 * Ids de los usuarios a quienes avisar de un correo en la casilla: los que figuran en
 * correo_casilla_accesos MÁS los admin/superadmin del tenant (ven todas las casillas activas sin
 * necesidad de fila de acceso). Sin duplicados. Una casilla de otro tenant o inexistente no
 * devuelve a nadie.
 */
export async function destinatariosCasilla(tenantId: string, casillaId: string): Promise<string[]> {
  const db = getDb()
  const [casilla] = await db
    .select({ id: correoCasillas.id })
    .from(correoCasillas)
    .where(and(eq(correoCasillas.id, casillaId), eq(correoCasillas.tenantId, tenantId)))
    .limit(1)
  if (!casilla) return []
  const filas = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .leftJoin(
      correoCasillaAccesos,
      and(eq(correoCasillaAccesos.adminUserId, adminUsers.id), eq(correoCasillaAccesos.casillaId, casillaId)),
    )
    .where(
      and(
        eq(adminUsers.tenantId, tenantId),
        or(inArray(adminUsers.role, ["admin", "superadmin"]), isNotNull(correoCasillaAccesos.casillaId)),
      ),
    )
  return [...new Set(filas.map((f) => f.id))]
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

// ── Accesos y administración de casillas (R3) ───────────────────────────────────────────────

/** Casillas del tenant (orden manual y luego nombre). `soloActivas` para lo que ve un lector. */
export async function listarCasillas(tenantId: string, opts: { soloActivas?: boolean } = {}): Promise<CasillaRow[]> {
  return getDb()
    .select()
    .from(correoCasillas)
    .where(and(eq(correoCasillas.tenantId, tenantId), opts.soloActivas ? eq(correoCasillas.activa, true) : undefined))
    .orderBy(asc(correoCasillas.orden), asc(correoCasillas.nombre), asc(correoCasillas.id))
}

/** Casillas ACTIVAS del tenant a las que el usuario tiene acceso explícito (operadores). */
export async function casillasDeUsuario(tenantId: string, userId: string): Promise<CasillaRow[]> {
  const filas = await getDb()
    .select({ casilla: correoCasillas })
    .from(correoCasillaAccesos)
    .innerJoin(correoCasillas, eq(correoCasillas.id, correoCasillaAccesos.casillaId))
    .where(
      and(
        eq(correoCasillaAccesos.adminUserId, userId),
        eq(correoCasillas.tenantId, tenantId),
        eq(correoCasillas.activa, true),
      ),
    )
    .orderBy(asc(correoCasillas.orden), asc(correoCasillas.nombre), asc(correoCasillas.id))
  return filas.map((f) => f.casilla)
}

/** Una casilla del tenant (activa o no); null si no existe o es de otro tenant. */
export async function casillaDelTenant(tenantId: string, casillaId: string): Promise<CasillaRow | null> {
  const [fila] = await getDb()
    .select()
    .from(correoCasillas)
    .where(and(eq(correoCasillas.id, casillaId), eq(correoCasillas.tenantId, tenantId)))
    .limit(1)
  return fila ?? null
}

/** Edita nombre/activa/orden de una casilla del tenant. null si no existe o es de otro tenant. */
export async function actualizarCasilla(
  tenantId: string,
  casillaId: string,
  cambios: { nombre?: string; activa?: boolean; orden?: number },
): Promise<CasillaRow | null> {
  const set: Partial<typeof correoCasillas.$inferInsert> = {}
  if (cambios.nombre !== undefined) set.nombre = cambios.nombre
  if (cambios.activa !== undefined) set.activa = cambios.activa
  if (cambios.orden !== undefined) set.orden = cambios.orden
  if (Object.keys(set).length === 0) return casillaDelTenant(tenantId, casillaId)
  const [fila] = await getDb()
    .update(correoCasillas)
    .set(set)
    .where(and(eq(correoCasillas.id, casillaId), eq(correoCasillas.tenantId, tenantId)))
    .returning()
  return fila ?? null
}

/** Operadores del tenant que se pueden tildar (admin y superadmin ya ven todas las casillas). */
export async function usuariosParaAcceso(tenantId: string): Promise<{ id: string; name: string; email: string }[]> {
  return getDb()
    .select({ id: adminUsers.id, name: adminUsers.name, email: adminUsers.email })
    .from(adminUsers)
    .where(and(eq(adminUsers.tenantId, tenantId), eq(adminUsers.role, "operator")))
    .orderBy(asc(adminUsers.name), asc(adminUsers.id))
}

/** Filas de acceso de todas las casillas del tenant (para armar la pantalla de una vez). */
export async function accesosDelTenant(tenantId: string): Promise<{ casillaId: string; adminUserId: string }[]> {
  return getDb()
    .select({ casillaId: correoCasillaAccesos.casillaId, adminUserId: correoCasillaAccesos.adminUserId })
    .from(correoCasillaAccesos)
    .innerJoin(correoCasillas, eq(correoCasillas.id, correoCasillaAccesos.casillaId))
    .where(eq(correoCasillas.tenantId, tenantId))
}

/**
 * Reemplaza, en una transacción, el conjunto de usuarios con acceso a una casilla. Rechaza (sin
 * escribir nada) una casilla ajena o ids que no sean operadores del tenant: `invalidos` lista los
 * ids rechazados (vacío si lo ajeno es la casilla).
 */
export async function reemplazarAccesos(
  tenantId: string,
  casillaId: string,
  userIds: string[],
): Promise<{ ok: true } | { ok: false; invalidos: string[] }> {
  const ids = [...new Set(userIds)]
  return getDb().transaction(async (tx) => {
    const [casilla] = await tx
      .select({ id: correoCasillas.id })
      .from(correoCasillas)
      .where(and(eq(correoCasillas.id, casillaId), eq(correoCasillas.tenantId, tenantId)))
      .limit(1)
    if (!casilla) return { ok: false as const, invalidos: [] }
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const malFormados = ids.filter((id) => !UUID.test(id))
    if (malFormados.length > 0) return { ok: false as const, invalidos: malFormados }
    if (ids.length > 0) {
      const validos = await tx
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(and(inArray(adminUsers.id, ids), eq(adminUsers.tenantId, tenantId), eq(adminUsers.role, "operator")))
      const setValidos = new Set(validos.map((v) => v.id))
      const invalidos = ids.filter((id) => !setValidos.has(id))
      if (invalidos.length > 0) return { ok: false as const, invalidos }
    }
    await tx.delete(correoCasillaAccesos).where(eq(correoCasillaAccesos.casillaId, casillaId))
    if (ids.length > 0) {
      await tx.insert(correoCasillaAccesos).values(ids.map((adminUserId) => ({ casillaId, adminUserId })))
    }
    return { ok: true as const }
  })
}
