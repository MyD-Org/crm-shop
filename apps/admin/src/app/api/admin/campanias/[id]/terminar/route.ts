import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { terminarCampania } from "@/lib/campanias-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, respuestaDeError } from "@/lib/precios-online-http"

// POST /api/admin/campanias/[id]/terminar — termina ahora una campaña activa (fin = ahora).
// 409 si no está activa. admin+ (operator -> 404). Tenant = el del guard.

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  try {
    await terminarCampania(guard.tenantId, id, guard.user)
    return Response.json({ ok: true }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
