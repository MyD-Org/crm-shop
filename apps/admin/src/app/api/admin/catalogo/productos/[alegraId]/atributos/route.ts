import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { parsearEdicionManual } from "@/lib/catalogo-atributos-extraccion"
import { guardarAtributosManual, leerAtributos } from "@/lib/catalogo-atributos-repo"
import { lecturaFichaConfigurada } from "@/lib/catalogo-atributos-pdf"
import { detalleProducto } from "@/lib/catalogo-overlay-repo"

// GET /api/admin/catalogo/productos/[alegraId]/atributos — datos técnicos estructurados del
//     producto (`catalog_atributos`, con su fuente) y si el lector de fichas está configurado.
// PUT /api/admin/catalogo/productos/[alegraId]/atributos — panel manual: `{ valores: { clave:
//     valor | null } }`. Un valor queda `fuente = 'manual'` (le gana a nombre y pdf); null lo quita.
//
// admin+ (operator → 404), como el resto de la edición del catálogo. Tenant = el del guard.

interface Params {
  params: Promise<{ alegraId: string }>
}

export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { alegraId } = await params
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()
  return Response.json(
    { atributos: await leerAtributos(guard.tenantId, alegraId), lectorConfigurado: lecturaFichaConfigurada() },
    { headers: NO_STORE },
  )
}

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { alegraId } = await params
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()

  const body = await req.json().catch(() => null)
  const edicion = parsearEdicionManual(body)
  if (!edicion.ok) return validacionResponse(edicion.error, edicion.campo)

  await guardarAtributosManual(guard.tenantId, alegraId, edicion.valores, edicion.quitar)
  await avisarShop(guard.tenantId)
  return Response.json({ atributos: await leerAtributos(guard.tenantId, alegraId) }, { headers: NO_STORE })
}
