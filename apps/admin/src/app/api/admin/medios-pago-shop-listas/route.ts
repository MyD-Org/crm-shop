import { requireAdminPlus } from "@/lib/admin-route-guard"
import { listasDisponiblesParaMedios } from "@/lib/medios-pago-shop-repo"
import { NO_STORE } from "@/lib/sucursales-respuestas"

// GET /api/admin/medios-pago-shop-listas — listas de precios de la cuenta principal de Alegra
// (id + nombre) que se pueden enlazar a un medio de pago. Admin o superadmin; tenant = el del
// guard. Va fuera de /medios-pago-shop/ para no chocar con el slug de un medio.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ listas: await listasDisponiblesParaMedios(guard.tenantId) }, { headers: NO_STORE })
}
