import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/precios-online-http"
import { leerConfig, listarListas, listarListasAlegra } from "@/lib/precios-online-repo"

// GET /api/admin/precios-online/listas — listas de precio online del tenant con sus ajustes por
// marca y por categoría, su condición de privada y sus enlaces con la lista de Alegra; las listas de
// Alegra disponibles para enlazar (de los contactos del espejo, por cuenta); y la configuración
// (versión y umbrales). Los cambios NO se hacen acá: pasan por previsualizar -> aplicar.
// admin+ (requireAdminPlus: operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const [listas, listasAlegra, config] = await Promise.all([
    listarListas(guard.tenantId),
    listarListasAlegra(guard.tenantId),
    leerConfig(guard.tenantId),
  ])
  return Response.json({ listas, listasAlegra, config }, { headers: NO_STORE })
}
