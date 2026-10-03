import { adminNotFoundResponse, adminUnauthorizedResponse } from "@/lib/admin-route-guard"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { requireCasilla } from "@/lib/correo-acceso"
import { correoHabilitado } from "@/lib/correo-flag"
import type { CasillaRow } from "@/lib/correo-repo"
import type { CorreoCarpeta } from "@/lib/correo-resend"

// Piezas comunes de las rutas de LECTURA del correo (/api/admin/correo/casillas/[id]/...).
// Las ve cualquier rol con acceso a la casilla (no solo admin): la autorización se decide acá,
// en el servidor. Orden: sesión (401) -> flag `correo` (404) -> acceso a la casilla (404 idéntico
// al de una casilla inexistente, sin oráculo).

export type LectorResult =
  | { ok: true; tenantId: string; user: { id: string; role: string }; casilla: CasillaRow }
  | { ok: false; response: Response }

export async function requireCorreoLector(req: Request, casillaId: string): Promise<LectorResult> {
  const guarded = await getGuardedAdminSession(req)
  if (!guarded.ok) return { ok: false, response: adminUnauthorizedResponse() }
  if (!(await correoHabilitado())) return { ok: false, response: adminNotFoundResponse() }
  const actor = { id: guarded.user.id, role: guarded.user.role }
  const r = await requireCasilla(guarded.tenantId, actor, casillaId)
  if (!r.ok) return r
  return { ok: true, tenantId: guarded.tenantId, user: actor, casilla: r.casilla }
}

export const CARPETAS_LISTABLES: CorreoCarpeta[] = ["inbox", "archive", "spam", "sent", "trash"]
/** A donde se puede MOVER un hilo (nunca a "sent"; y nunca hay borrado definitivo). */
export const CARPETAS_DESTINO = ["inbox", "archive", "spam", "trash"] as const
export type CarpetaDestino = (typeof CARPETAS_DESTINO)[number]

const ID_RESEND = /^[A-Za-z0-9_-]{1,100}$/
/** Ids de hilo/mensaje/adjunto de Resend: se validan antes de armar cualquier path hacia Resend. */
export const esIdResend = (v: string): boolean => ID_RESEND.test(v)

export function parseCarpeta(v: string | null): CorreoCarpeta {
  return CARPETAS_LISTABLES.includes(v as CorreoCarpeta) ? (v as CorreoCarpeta) : "inbox"
}

export const LIMITE_POR_DEFECTO = 25
export const LIMITE_MAXIMO = 50
export const BUSQUEDA_MAX = 200

export function parseLimite(v: string | null): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, LIMITE_MAXIMO) : LIMITE_POR_DEFECTO
}

export function parsePatchHilo(
  body: unknown,
): { ok: true; valor: { leido?: boolean; carpeta?: CarpetaDestino } } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Los datos enviados no son válidos." }
  const b = body as Record<string, unknown>
  const valor: { leido?: boolean; carpeta?: CarpetaDestino } = {}
  if (b.leido !== undefined) {
    if (typeof b.leido !== "boolean") return { ok: false, error: "Indique si la conversación está leída o no leída." }
    valor.leido = b.leido
  }
  if (b.carpeta !== undefined) {
    if (!CARPETAS_DESTINO.includes(b.carpeta as CarpetaDestino)) return { ok: false, error: "Seleccione una carpeta válida." }
    valor.carpeta = b.carpeta as CarpetaDestino
  }
  if (valor.leido === undefined && valor.carpeta === undefined) return { ok: false, error: "No se indicó ningún cambio." }
  return { ok: true, valor }
}

/** Tope de descarga (límite de Resend por mail): 40 MB. */
export const ADJUNTO_MAX_BYTES = 40 * 1024 * 1024
