import { adminNotFoundResponse, requireSeccion } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { leerDatosEnvio } from "@/lib/catalogo-datos-envio-repo"
import { detalleProducto } from "@/lib/catalogo-overlay-repo"

// GET /api/admin/catalogo/productos/[alegraId]/envio — datos de envío del producto (peso y medidas
//     con embalaje, unidad mínima, unidades por caja master). Sólo lectura: se cargan por script.
//     `{ datosEnvio: null }` = sin datos. No se exponen en la tienda.
//
// Con la sección "catalogo" (sin ella → 404), como el resto de la ficha. Tenant = el del guard.

interface Params {
  params: Promise<{ alegraId: string }>
}

export async function GET(req: Request, { params }: Params) {
  const guard = await requireSeccion(req, "catalogo")
  if (!guard.ok) return guard.response
  const { alegraId } = await params
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()
  return Response.json({ datosEnvio: await leerDatosEnvio(guard.tenantId, alegraId) }, { headers: NO_STORE })
}
