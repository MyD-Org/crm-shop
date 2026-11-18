import { requireSeccion } from "@/lib/admin-route-guard"
import { leerCampania } from "@/lib/campanias-http"
import { previsualizarCampania } from "@/lib/campanias-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"
import { puedeVerCostos, sinCampos } from "@/lib/secciones"

// POST /api/admin/campanias/previsualizar — { campania, exceptoId? } -> { previa }: productos
// alcanzados, cuántos quedan por debajo del costo, una muestra normal -> campaña por lista y el
// choque de fechas con otra campaña (si lo hay). No guarda nada. Con la sección (sin ella -> 404). Sin
// permiso de costos (`puedeVerCostos`) la muestra no incluye `costo` (el conteo `bajoCosto` sí).

export async function POST(req: Request) {
  const guard = await requireSeccion(req, "catalogo")
  if (!guard.ok) return guard.response
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const campania = leerCampania(body.campania)
  if (campania instanceof Response) return campania
  const exceptoId = typeof body.exceptoId === "string" && esUuid(body.exceptoId) ? body.exceptoId : undefined
  try {
    const previa = await previsualizarCampania(guard.tenantId, campania, exceptoId)
    const conCostos = puedeVerCostos(guard.user)
      ? previa
      : { ...previa, muestra: previa.muestra.map((f) => sinCampos(f, ["costo"])) }
    return Response.json({ previa: conCostos }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
