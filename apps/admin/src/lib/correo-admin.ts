import { adminNotFoundResponse, requireAdminPlus, type AdminGuardResult } from "@/lib/admin-route-guard"
import { correoHabilitado } from "@/lib/correo-flag"
import { accesosDelTenant, listarCasillas, usuariosParaAcceso } from "@/lib/correo-repo"
import { NOMBRE_CASILLA_MAX } from "@/lib/correo-admin-constantes"
import { CorreoResendError } from "@/lib/correo-resend"

// Piezas comunes de las rutas /api/admin/correo/casillas/* (administración de casillas y
// accesos: solo admin y superadmin).

export const NO_STORE = { "Cache-Control": "private, no-store" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuid(valor: string): boolean {
  return UUID.test(valor)
}

/** Admin+ con el flag `correo` prendido. Sin sesión 401; operador o flag apagado, 404 idéntico. */
export async function requireCorreoAdmin(req: Request): Promise<AdminGuardResult> {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard
  if (!(await correoHabilitado())) return { ok: false, response: adminNotFoundResponse() }
  return guard
}

export function errorJson(error: string, status: number, code = "invalid"): Response {
  return Response.json({ error, code }, { status, headers: NO_STORE })
}

/** Error de Resend -> respuesta en usted, sin cuerpo crudo ni claves (el mensaje ya viene limpio). */
export function respuestaErrorResend(e: unknown): Response {
  if (e instanceof CorreoResendError) {
    const status = e.code === "no_configurado" ? 503 : e.code === "limite" ? 429 : 502
    return errorJson(e.message, status, e.code)
  }
  console.error("[correo] error inesperado al consultar las casillas")
  return errorJson("No se pudo completar la operación. Inténtelo nuevamente.", 500, "servidor")
}

/** Error de Resend en una ruta de lectura: "no encontrado" es el mismo 404 de siempre. */
export function errorLectura(e: unknown): Response {
  if (e instanceof CorreoResendError && e.code === "no_encontrado") return adminNotFoundResponse()
  return respuestaErrorResend(e)
}

export interface CasillaAdminVista {
  id: string
  email: string
  nombre: string
  activa: boolean
  orden: number
  adminUserIds: string[]
}

/** Lo que muestra el Dialog: casillas del tenant con sus accesos y los operadores tildables. */
export async function vistaCasillas(tenantId: string) {
  const [casillas, usuarios, accesos] = await Promise.all([
    listarCasillas(tenantId),
    usuariosParaAcceso(tenantId),
    accesosDelTenant(tenantId),
  ])
  const porCasilla = new Map<string, string[]>()
  for (const a of accesos) porCasilla.set(a.casillaId, [...(porCasilla.get(a.casillaId) ?? []), a.adminUserId])
  return {
    casillas: casillas.map(
      (c): CasillaAdminVista => ({
        id: c.id,
        email: c.email,
        nombre: c.nombre,
        activa: c.activa,
        orden: c.orden,
        adminUserIds: porCasilla.get(c.id) ?? [],
      }),
    ),
    usuarios,
  }
}

export type ParseResult<T> = { ok: true; valor: T } | { ok: false; error: string }

export function parseCasillaPatch(body: unknown): ParseResult<{ nombre?: string; activa?: boolean }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Los datos enviados no son válidos." }
  const b = body as Record<string, unknown>
  const valor: { nombre?: string; activa?: boolean } = {}
  if (b.nombre !== undefined) {
    if (typeof b.nombre !== "string") return { ok: false, error: "Indique un nombre válido para la casilla." }
    const nombre = b.nombre.trim()
    if (!nombre) return { ok: false, error: "Indique un nombre para la casilla." }
    if (nombre.length > NOMBRE_CASILLA_MAX) {
      return { ok: false, error: `El nombre no puede superar los ${NOMBRE_CASILLA_MAX} caracteres.` }
    }
    valor.nombre = nombre
  }
  if (b.activa !== undefined) {
    if (typeof b.activa !== "boolean") return { ok: false, error: "Indique si la casilla está activa o no." }
    valor.activa = b.activa
  }
  if (valor.nombre === undefined && valor.activa === undefined) return { ok: false, error: "No hay cambios para guardar." }
  return { ok: true, valor }
}

export function parseAccesosBody(body: unknown): ParseResult<string[]> {
  const ids = (body as { admin_user_ids?: unknown } | null)?.admin_user_ids
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every((i) => typeof i === "string")) {
    return { ok: false, error: "Indique la lista de usuarios con acceso." }
  }
  return { ok: true, valor: ids as string[] }
}
