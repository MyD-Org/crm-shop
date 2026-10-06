import { requireAdminPlus } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { listarGrilla, parsearQueryGrilla } from "@/lib/precios-online-grilla"
import { NO_STORE } from "@/lib/precios-online-http"

// GET /api/admin/catalogo/precios-online — grilla de precios online.
//   ?q= &marca= &categoria=(uuid|sin) &estado=(ok|sin-costo|sin-precio|retenido|nuevo) &lista=uuid
//   &orden=(nombre|precio|costo) &start= &limit= (máx. 100)
//
// Filtrado, conteo, orden y paginado se resuelven en Postgres: el navegador recibe una página. Para
// los ids de la página trae el coeficiente efectivo y su origen por lista, y los precios de las
// listas de Alegra por cuenta como REFERENCIA informativa (nunca participan del cálculo). El costo
// solo viaja al admin. admin+ (operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const parsed = parsearQueryGrilla(new URL(req.url))
  if (!parsed.ok) return invalidResponse(parsed.error)
  const { items, total } = await listarGrilla(guard.tenantId, parsed.filtros, {
    start: parsed.start,
    limit: parsed.limit,
    orden: parsed.orden,
  })
  return Response.json({ items, total, start: parsed.start, limit: parsed.limit }, { headers: NO_STORE })
}
