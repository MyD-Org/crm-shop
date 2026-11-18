import { puedeVerSeccion, type ActorSecciones } from "@/lib/secciones"
import type { ResultadoBorrado, ResultadoSucursal, ResultadoZona } from "@/lib/sucursales-repo"

// Respuestas de /api/admin/sucursales/*, reglas-venta, envíos, despacho y métodos de envío. El
// guard es `requireSeccion` (change `permisos-por-seccion`): 401 sin sesión, 404 sin la sección.
// El tenant sale SOLO del guard.

export const NO_STORE = { "Cache-Control": "private, no-store" }

/**
 * Rutas de Sucursales que también escribe la sección Envíos (EnviosSucursalesCard): quien entra
 * sólo por Envíos puede tocar únicamente los campos que esa tarjeta edita. true = el cuerpo trae
 * otro campo y hay que rechazarlo (404, como si no tuviera la sección). Un cuerpo que no es objeto
 * lo rechaza después la validación del repo.
 */
export function excedeCamposDeEnvios(user: ActorSecciones, body: unknown, permitidos: readonly string[]): boolean {
  if (puedeVerSeccion(user, "sucursales")) return false
  if (!body || typeof body !== "object" || Array.isArray(body)) return false
  return Object.keys(body).some((k) => !permitidos.includes(k))
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
