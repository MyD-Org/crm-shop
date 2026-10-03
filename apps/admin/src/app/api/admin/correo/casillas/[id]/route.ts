import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { NO_STORE, errorJson, esUuid, parseCasillaPatch, requireCorreoAdmin } from "@/lib/correo-admin"
import { actualizarCasilla } from "@/lib/correo-repo"

type IdParams = { params: Promise<{ id: string }> }

// PATCH /api/admin/correo/casillas/[id] — nombre visible y/o activa/inactiva. Solo admin+ con el
// flag prendido. Una casilla de otro tenant o inexistente responde el mismo 404.
export async function PATCH(req: Request, { params }: IdParams) {
  const guard = await requireCorreoAdmin(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()

  const parsed = parseCasillaPatch(await req.json().catch(() => null))
  if (!parsed.ok) return errorJson(parsed.error, 400)

  const casilla = await actualizarCasilla(guard.tenantId, id, parsed.valor)
  if (!casilla) return adminNotFoundResponse()
  return Response.json(
    { casilla: { id: casilla.id, email: casilla.email, nombre: casilla.nombre, activa: casilla.activa, orden: casilla.orden } },
    { headers: NO_STORE },
  )
}
