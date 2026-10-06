import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, leerClavesDePrevia, leerJson, respuestaDeError } from "@/lib/precios-online-http"
import { aplicarReversion, previsualizarReversion } from "@/lib/precios-online-repo"

// POST /api/admin/precios-online/historial/[id]/revertir
//   { previa: true }                              -> vista previa de los cambios inversos (no escribe).
//   { baseVersion, huella, confirmaExtra? }       -> aplica la reversión (mismo camino que cualquier cambio).
// Solo se revierte la ÚLTIMA entrada vigente de cada objeto (409 `choque` si hay una posterior) y
// una sola vez (409 `ya_revertido`). admin+ (operator -> 404). Tenant = el del guard.

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const body = await leerJson(req)
  if (body instanceof Response) return body
  try {
    if (body.previa === true) {
      const { resultado, cambios } = await previsualizarReversion(guard.tenantId, id)
      return Response.json({ previa: resultado, cambios }, { headers: NO_STORE })
    }
    const claves = leerClavesDePrevia(body)
    if (claves instanceof Response) return claves
    const r = await aplicarReversion(guard.tenantId, guard.user, id, claves)
    return Response.json({ version: r.version, resultado: r.resultado }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
