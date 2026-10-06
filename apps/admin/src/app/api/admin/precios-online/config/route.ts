import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/precios-online-http"
import { leerConfig } from "@/lib/precios-online-repo"

// GET /api/admin/precios-online/config — versión de la configuración y umbrales (confirmación
// extra 20 % y retención por costo 10 % por defecto). Se cambian con previsualizar -> aplicar
// (operación `setUmbrales`, queda en el historial). admin+ (operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ config: await leerConfig(guard.tenantId) }, { headers: NO_STORE })
}
