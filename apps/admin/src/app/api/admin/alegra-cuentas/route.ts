import { requireAdminPlus } from "@/lib/admin-route-guard"
import { listarCuentas } from "@/lib/alegra-cuentas-repo"
import { NO_STORE } from "@/lib/sucursales-respuestas"

// GET /api/admin/alegra-cuentas — cuentas de Alegra del tenant y a qué sucursal está asignada
// cada una. Admin o superadmin (las credenciales son de plataforma). El token NUNCA sale de acá:
// solo `tokenConfigurado` y, si es largo, sus últimos 4 caracteres. Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json(await listarCuentas(guard.tenantId), { headers: NO_STORE })
}
