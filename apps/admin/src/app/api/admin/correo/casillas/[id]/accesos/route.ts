import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { NO_STORE, errorJson, esUuid, parseAccesosBody, requireCorreoAdmin } from "@/lib/correo-admin"
import { accesosDelTenant, casillaDelTenant, reemplazarAccesos } from "@/lib/correo-repo"

type IdParams = { params: Promise<{ id: string }> }

// GET/PUT /api/admin/correo/casillas/[id]/accesos — operadores con acceso a la casilla. Solo
// admin+ con el flag prendido. Admin y superadmin ven todas las casillas sin figurar acá. El PUT
// reemplaza el conjunto completo y rechaza ids que no sean operadores del tenant.

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireCorreoAdmin(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id) || !(await casillaDelTenant(guard.tenantId, id))) return adminNotFoundResponse()
  const accesos = await accesosDelTenant(guard.tenantId)
  return Response.json(
    { adminUserIds: accesos.filter((a) => a.casillaId === id).map((a) => a.adminUserId) },
    { headers: NO_STORE },
  )
}

export async function PUT(req: Request, { params }: IdParams) {
  const guard = await requireCorreoAdmin(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()

  const parsed = parseAccesosBody(await req.json().catch(() => null))
  if (!parsed.ok) return errorJson(parsed.error, 400)

  const r = await reemplazarAccesos(guard.tenantId, id, parsed.valor)
  if (!r.ok) {
    if (r.invalidos.length === 0) return adminNotFoundResponse()
    return errorJson("Hay usuarios que no se pueden asignar a esta casilla. Actualice la pantalla e inténtelo nuevamente.", 400)
  }
  return Response.json({ ok: true, adminUserIds: [...new Set(parsed.valor)] }, { headers: NO_STORE })
}
