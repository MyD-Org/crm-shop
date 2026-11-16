import { adminNotFoundResponse, requireComprasAccess } from "@/lib/admin-route-guard"
import { comprasRecepcionHabilitada } from "@/lib/compras-flag"
import { esUuid, ok, responderError, toCompraDetalleDto } from "@/lib/compras-http"
import { anularCompra, detalleCompra, editarCompraDesdeBody } from "@/lib/compras-service"

// GET    /api/admin/compras/[id] — detalle (una compra que quedó en 'creando' se reconcilia al abrir).
// PATCH  /api/admin/compras/[id] — edita ítems y percepciones (sólo pendiente y sin recepciones;
//                                  requiere además el flag `compras-recepcion`).
// DELETE /api/admin/compras/[id] — anula la compra (borra la factura en Alegra; sólo pendiente).
//
// Un id mal formado, inexistente o de OTRO tenant contesta el mismo 404.

type IdParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  try {
    const compra = await detalleCompra(guard.tenantId, id)
    if (!compra) return adminNotFoundResponse()
    return ok({ compra: toCompraDetalleDto(compra) })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId, compraId: id })
  }
}

export async function PATCH(req: Request, { params }: IdParams) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  if (!(await comprasRecepcionHabilitada())) return adminNotFoundResponse()
  const body: unknown = await req.json().catch(() => null)
  try {
    await editarCompraDesdeBody(guard.tenantId, id, body)
    return ok({ ok: true })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId, compraId: id })
  }
}

export async function DELETE(req: Request, { params }: IdParams) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  try {
    await anularCompra(guard.tenantId, id)
    return ok({ ok: true })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId, compraId: id })
  }
}

