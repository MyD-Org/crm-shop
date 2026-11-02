import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { generarTokenIntegracion, revocarTokenIntegracion } from "@/lib/cupones-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, respuestaDeError } from "@/lib/precios-online-http"

// POST   /api/admin/cupones/[id]/token — genera (o reemplaza) el token del bot -> { token }. Se
//        muestra UNA vez: la base guarda sólo su hash.
// DELETE /api/admin/cupones/[id]/token — lo revoca -> 204.
// 422 `solo_unicos` si la promoción es genérica. admin+ (operator -> 404).

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  try {
    return Response.json(await generarTokenIntegracion(guard.tenantId, id, guard.user), { headers: NO_STORE })
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
    await revocarTokenIntegracion(guard.tenantId, id, guard.user)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
