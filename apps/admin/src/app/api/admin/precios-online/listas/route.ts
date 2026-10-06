import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/precios-online-http"
import { leerConfig, listarListas } from "@/lib/precios-online-repo"

// GET /api/admin/precios-online/listas — listas de precio online del tenant con sus ajustes por
// marca y por categoría, y la configuración (versión y umbrales). Los cambios NO se hacen acá:
// pasan por previsualizar -> aplicar. admin+ (requireAdminPlus: operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const [listas, config] = await Promise.all([listarListas(guard.tenantId), leerConfig(guard.tenantId)])
  return Response.json({ listas, config }, { headers: NO_STORE })
}
