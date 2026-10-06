import { requireAdminPlus } from "@/lib/admin-route-guard"
import { contarAlertas } from "@/lib/precios-online-costos"
import { NO_STORE } from "@/lib/precios-online-http"

// GET /api/admin/precios-online/alertas — contadores de la alerta de pendientes: sin costo, sin
// precio online, nuevos sin revisar y retenidos por variación de costo. admin+ (operator -> 404).

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ alertas: await contarAlertas(guard.tenantId) }, { headers: NO_STORE })
}
