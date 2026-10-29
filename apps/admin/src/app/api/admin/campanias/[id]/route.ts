import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { leerCampania as leerEntrada } from "@/lib/campanias-http"
import { eliminarCampania, guardarCampania, leerCampania } from "@/lib/campanias-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"

// GET    /api/admin/campanias/[id] — { campania } con sus reglas.
// PUT    /api/admin/campanias/[id] — edita (programada o activa; una activa no mueve su inicio).
// DELETE /api/admin/campanias/[id] — sólo una programada -> 204.
// admin+ (operator -> 404). Tenant = el del guard.

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const campania = await leerCampania(guard.tenantId, id)
  if (!campania) return adminNotFoundResponse()
  return Response.json({ campania }, { headers: NO_STORE })
}

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const campania = leerEntrada(body)
  if (campania instanceof Response) return campania
  try {
    await guardarCampania(guard.tenantId, campania, guard.user, id)
    return Response.json({ id }, { headers: NO_STORE })
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
    await eliminarCampania(guard.tenantId, id, guard.user)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
