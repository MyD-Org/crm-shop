import { requireAdminPlus } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { esUuid, MSG_BODY } from "@/lib/precios-online-cambios"
import { aprobarRetenidos, listarRetenidos, rechazarRetenidos } from "@/lib/precios-online-costos"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"
import { puedeVerCostos, sinCampos } from "@/lib/secciones"

// Cambios de costo desde Alegra retenidos por superar el umbral de retención.
//   GET  /api/admin/precios-online/retenciones?start=&limit=   -> pendientes de aprobación.
//   POST { accion: "aprobar" | "rechazar", ids: [uuid], confirmar?: boolean }
//        Resolver varios a la vez exige confirmar: true. Aprobar actualiza el precio y deja historial;
//        rechazar mantiene el precio vigente. Un retenido sin costo propuesto no se aprueba (se omite).
// admin+ (operator -> 404). Tenant = el del guard. Sin permiso de costos (`puedeVerCostos`) el GET
// no incluye `costoVigente` ni `costoPropuesto` (sí la variación y si queda sin costo).

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const p = new URL(req.url).searchParams
  const start = Number(p.get("start") ?? 0)
  const limit = Number(p.get("limit") ?? 50)
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1) {
    return invalidResponse("Los filtros indicados no son válidos.")
  }
  const r = await listarRetenidos(guard.tenantId, { start, limit: Math.min(limit, 100) })
  const items = puedeVerCostos(guard.user)
    ? r.items
    : r.items.map((item) => sinCampos(item, ["costoVigente", "costoPropuesto"]))
  return Response.json({ ...r, items, start }, { headers: NO_STORE })
}

const MAX_IDS = 200

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const { accion, ids, confirmar } = body
  if (accion !== "aprobar" && accion !== "rechazar") return invalidResponse(MSG_BODY, "accion")
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every(esUuid)) {
    return invalidResponse("Seleccione los productos a resolver.", "ids")
  }
  if (ids.length > 1 && confirmar !== true) {
    return invalidResponse("Confirme para resolver varios cambios a la vez.", "confirmar")
  }
  try {
    const unicos = [...new Set(ids as string[])]
    const r =
      accion === "aprobar"
        ? await aprobarRetenidos(guard.tenantId, guard.user, unicos)
        : await rechazarRetenidos(guard.tenantId, guard.user, unicos)
    return Response.json(r, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
