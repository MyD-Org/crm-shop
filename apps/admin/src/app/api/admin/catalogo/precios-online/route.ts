import { requireSeccion } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { listarGrilla, listarIds, parsearQueryGrilla } from "@/lib/precios-online-grilla"
import { NO_STORE } from "@/lib/precios-online-http"
import { puedeVerCostos, sinCampos } from "@/lib/secciones"

// GET /api/admin/catalogo/precios-online — grilla de precios online.
//   ?q= &marca= &categoria=(uuid|sin) &estado=(ok|sin-costo|sin-precio|retenido|nuevo) &lista=uuid
//   &orden=(nombre|precio|costo) &start= &limit= (máx. 100)
//   &modo=ids -> {items:[{alegraId,nombre,codigo}], total, tope}: todos los resultados del filtro (tope 2000).
//
// Filtrado, conteo, orden y paginado se resuelven en Postgres: el navegador recibe una página. Para
// los ids de la página trae el coeficiente efectivo y su origen por lista, y los precios de las
// listas de Alegra por cuenta como REFERENCIA informativa (nunca participan del cálculo). El costo
// (`costo`, `costoAplicado`) sólo viaja con permiso de costos (`puedeVerCostos`, fila fresca): sin
// él las claves no existen en la respuesta. Con la sección (sin ella -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireSeccion(req, "catalogo")
  if (!guard.ok) return guard.response
  const parsed = parsearQueryGrilla(new URL(req.url))
  if (!parsed.ok) return invalidResponse(parsed.error)
  // modo=ids: los ids de TODOS los resultados del filtro (tope 2000) para la selección masiva.
  if (new URL(req.url).searchParams.get("modo") === "ids") {
    const r = await listarIds(guard.tenantId, parsed.filtros)
    return Response.json(r, { headers: NO_STORE })
  }
  const { items, total } = await listarGrilla(guard.tenantId, parsed.filtros, {
    start: parsed.start,
    limit: parsed.limit,
    orden: parsed.orden,
  })
  const filas = puedeVerCostos(guard.user)
    ? items
    : items.map((fila) => sinCampos(fila, ["costo", "costoAplicado"]))
  return Response.json({ items: filas, total, start: parsed.start, limit: parsed.limit }, { headers: NO_STORE })
}
