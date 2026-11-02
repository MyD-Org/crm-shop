import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { leerPromocionEntrada } from "@/lib/cupones-http"
import { eliminarPromocion, guardarPromocion, leerPromocion, pausarPromocion } from "@/lib/cupones-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"

// GET    /api/admin/cupones/[id] — { promocion }.
// PUT    /api/admin/cupones/[id] — edita; con canjes no cambia tipo ni % (409 `promocion_con_canjes`).
// PATCH  /api/admin/cupones/[id] — { activa } pausa o reanuda.
// DELETE /api/admin/cupones/[id] — sólo sin canjes -> 204 (borra sus códigos).
// admin+ (operator -> 404). Tenant = el del guard.

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const promocion = await leerPromocion(guard.tenantId, id)
  if (!promocion) return adminNotFoundResponse()
  return Response.json({ promocion }, { headers: NO_STORE })
}

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const promocion = leerPromocionEntrada(body)
  if (promocion instanceof Response) return promocion
  try {
    await guardarPromocion(guard.tenantId, promocion, guard.user, id)
    return Response.json({ id }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const body = await leerJson(req)
  if (body instanceof Response) return body
  if (typeof body.activa !== "boolean") return invalidResponse("Indique si la promoción queda activa.", "activa")
  try {
    await pausarPromocion(guard.tenantId, id, body.activa, guard.user)
    return Response.json({ id, activa: body.activa }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  try {
    await eliminarPromocion(guard.tenantId, id, guard.user)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
