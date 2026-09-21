import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conUrlDeFotos, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { validarCamposOverlay } from "@/lib/catalogo-overlay"
import {
  asignarTagsProducto,
  categoriaPropia,
  detalleProducto,
  guardarOverlay,
} from "@/lib/catalogo-overlay-repo"

// GET   /api/admin/catalogo/productos/[alegraId] — ficha: lo de Alegra (sólo lectura) + overlay.
// PATCH /api/admin/catalogo/productos/[alegraId] — upsert del overlay.
//
// El PATCH persiste SÓLO los campos enviados: editar el nombre no puede pisar la categoría, las
// etiquetas ni las fotos (REQ-ADM-04). Precio, stock y alegra_id no viven en el overlay y no hay
// forma de mandarlos (REQ-OVL-02).
//
// Un alegraId inexistente o de otro tenant devuelve el MISMO 404 que el guard de operator: el
// cuerpo idéntico es lo que cierra el oráculo de existencia.

type Params = { params: Promise<{ alegraId: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()
  return Response.json({ producto: conUrlDeFotos(producto) }, { headers: NO_STORE })
}

export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  // El overlay es esparso: se edita sobre el producto espejado, no sobre una fila que tenga que
  // existir de antemano. Pero el producto sí tiene que existir en ESTE tenant.
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()

  const body = await req.json().catch(() => null)
  const v = validarCamposOverlay(body)
  if (!v.ok) return validacionResponse(v.error, v.campo)

  const { tagIds, ...campos } = v.value
  if (campos.categoriaId != null && !(await categoriaPropia(guard.tenantId, campos.categoriaId))) {
    return validacionResponse("Seleccione una categoría válida", "categoriaId")
  }

  if (Object.keys(campos).length > 0) {
    await guardarOverlay(guard.tenantId, alegraId, campos, guard.user.id)
  }
  if (tagIds !== undefined) {
    // Reemplaza el conjunto entero y bumpea updated_at en la misma transacción: los tags viven
    // en otra tabla y sin eso el cambio nunca viajaría al Shop.
    await asignarTagsProducto(guard.tenantId, alegraId, tagIds, guard.user.id)
  }

  const producto = await detalleProducto(guard.tenantId, alegraId)
  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, producto }, { headers: NO_STORE })
}
