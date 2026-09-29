import { getGuardedAdminSession } from "@/lib/admin-session"
import { adminUnauthorizedResponse, type AdminGuardResult } from "@/lib/admin-route-guard"
import { isKnownAdminRole } from "@/lib/roles"
import type { ResultadoBorrado, ResultadoSucursal, ResultadoZona } from "@/lib/sucursales-repo"

// Guard y respuestas de /api/admin/sucursales/*. Operador o superior (spec "Permiso"): 401 sin
// sesión, 403 en usted con un rol que no existe. El tenant sale SOLO del guard.

export const NO_STORE = { "Cache-Control": "private, no-store" }

export async function requireSucursalesAccess(req: Request): Promise<AdminGuardResult> {
  const guarded = await getGuardedAdminSession(req)
  if (!guarded.ok) {
    console.warn(`[sucursales-guard] request rechazado: ${guarded.reason}`)
    return { ok: false, response: adminUnauthorizedResponse() }
  }
  // Rol de la fila fresca (no el de la cookie), con lista explícita de roles conocidos.
  if (!isKnownAdminRole(guarded.user.role)) {
    return {
      ok: false,
      response: Response.json(
        { error: "No tiene permiso para administrar las sucursales.", code: "forbidden" },
        { status: 403, headers: NO_STORE },
      ),
    }
  }
  return { ok: true, tenantId: guarded.tenantId, user: guarded.user }
}

export function noEncontrado(): Response {
  return Response.json({ error: "No encontramos el registro indicado.", code: "not_found" }, { status: 404, headers: NO_STORE })
}

type ConError = Exclude<ResultadoSucursal | ResultadoZona | ResultadoBorrado, { kind: "ok" } | { kind: "not_found" }>

/** 400 validación, 409 conflicto (con `campo` cuando lo hay). */
export function errorDeResultado(r: ConError): Response {
  if (r.kind === "invalid") {
    return Response.json({ error: r.error, code: "invalid", campo: r.campo }, { status: 400, headers: NO_STORE })
  }
  const campo = "campo" in r ? r.campo : undefined
  return Response.json({ error: r.error, code: "conflict", campo }, { status: 409, headers: NO_STORE })
}
