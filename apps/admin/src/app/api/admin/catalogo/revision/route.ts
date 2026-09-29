import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { revisionDeCatalogo } from "@/lib/catalogo-revision"

// GET /api/admin/catalogo/revision — solapa "Revisión" del catálogo (cuentas de Alegra secundarias):
//  - "Códigos a revisar": códigos duplicados o faltantes de la última sync de cada cuenta (esos
//    ítems no entran al catálogo);
//  - "Productos solo en <cuenta>": informativo.
// Sin credenciales en la respuesta. admin+ (requireAdminPlus: operator → 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const cuentas = await revisionDeCatalogo(guard.tenantId)
  return Response.json({ cuentas }, { headers: NO_STORE })
}
