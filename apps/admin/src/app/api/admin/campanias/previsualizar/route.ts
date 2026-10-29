import { requireAdminPlus } from "@/lib/admin-route-guard"
import { leerCampania } from "@/lib/campanias-http"
import { previsualizarCampania } from "@/lib/campanias-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"

// POST /api/admin/campanias/previsualizar — { campania, exceptoId? } -> { previa }: productos
// alcanzados, cuántos quedan por debajo del costo, una muestra normal -> campaña por lista y el
// choque de fechas con otra campaña (si lo hay). No guarda nada. admin+ (operator -> 404).

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const campania = leerCampania(body.campania)
  if (campania instanceof Response) return campania
  const exceptoId = typeof body.exceptoId === "string" && esUuid(body.exceptoId) ? body.exceptoId : undefined
  try {
    return Response.json({ previa: await previsualizarCampania(guard.tenantId, campania, exceptoId) }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
