import { requireAdminPlus } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { NO_STORE } from "@/lib/precios-online-http"
import { listarHistorial } from "@/lib/precios-online-repo"

// GET /api/admin/precios-online/historial?start=&limit= — cambios aplicados (quién, cuándo, antes
// y después, cantidad de productos afectados), del más nuevo al más viejo. Inmutable: no hay
// endpoint que lo edite o borre. admin+ (operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const p = new URL(req.url).searchParams
  const start = Number(p.get("start") ?? 0)
  const limit = Number(p.get("limit") ?? 50)
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1) {
    return invalidResponse("Los filtros indicados no son válidos.")
  }
  return Response.json({ ...(await listarHistorial(guard.tenantId, { start, limit: Math.min(limit, 100) })), start }, { headers: NO_STORE })
}
