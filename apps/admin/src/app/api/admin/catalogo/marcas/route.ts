import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { listarMarcas } from "@/lib/precios-online-repo"

// GET /api/admin/catalogo/marcas — marcas del catálogo del tenant para el filtro del listado.
// `clave` es la marca normalizada (`lower(btrim(brand))`) y `nombre` una de sus grafías reales.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const marcas = await listarMarcas(guard.tenantId)
  return Response.json({ marcas }, { headers: NO_STORE })
}
