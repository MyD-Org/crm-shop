import { NO_STORE, invalidResponse } from "@/lib/catalogo-admin"
import { PreciosOnlineError, type EntradaAplicar } from "@/lib/precios-online-repo"
import { MSG_BODY, validarCambios } from "@/lib/precios-online-cambios"

// Piezas HTTP compartidas por /api/admin/precios-online/*. Textos en usted.

export { NO_STORE }

/** Un PreciosOnlineError como respuesta (404 / 409 / 422). Otro error se relanza. */
export function respuestaDeError(err: unknown): Response {
  if (err instanceof PreciosOnlineError) {
    return Response.json(
      { error: err.message, code: err.code, ...err.extra },
      { status: err.status, headers: NO_STORE },
    )
  }
  throw err
}

export async function leerJson(req: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return invalidResponse(MSG_BODY)
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalidResponse(MSG_BODY)
  return body as Record<string, unknown>
}

export function leerClavesDePrevia(
  body: Record<string, unknown>,
): { baseVersion: number; huella: string; confirmaExtra: boolean } | Response {
  const { baseVersion, huella, confirmaExtra } = body
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return invalidResponse("Genere una vista previa antes de aplicar.", "baseVersion")
  }
  if (typeof huella !== "string" || !/^[0-9a-f]{64}$/.test(huella)) {
    return invalidResponse("Genere una vista previa antes de aplicar.", "huella")
  }
  if (confirmaExtra !== undefined && typeof confirmaExtra !== "boolean") return invalidResponse(MSG_BODY, "confirmaExtra")
  return { baseVersion, huella, confirmaExtra: confirmaExtra === true }
}

/** Body de `previsualizar` y `aplicar`: los `cambios` validados (+ las claves de la previa en aplicar). */
export async function leerEntradaAplicar(req: Request): Promise<EntradaAplicar | Response> {
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const v = validarCambios(body.cambios)
  if (!v.ok) return invalidResponse(v.error, v.campo)
  const claves = leerClavesDePrevia(body)
  if (claves instanceof Response) return claves
  return { cambios: v.cambios, ...claves }
}
