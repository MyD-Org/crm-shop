import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE, leerEntradaAplicar, respuestaDeError } from "@/lib/precios-online-http"
import { aplicarCambios } from "@/lib/precios-online-repo"

// POST /api/admin/precios-online/aplicar — { cambios, baseVersion, huella, confirmaExtra? }.
// Aplica los cambios en UNA transacción, SOLO si la vista previa sigue vigente (409
// "La vista previa quedó desactualizada. Genere una nueva.") y, si la variación de algún precio
// SUPERA el umbral de confirmación, solo con `confirmaExtra: true` (409 `confirmacion_extra`).
// Deja el historial y recalcula los precios online. admin+ (operator -> 404). Tenant = el del guard.

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const entrada = await leerEntradaAplicar(req)
  if (entrada instanceof Response) return entrada
  try {
    const r = await aplicarCambios(guard.tenantId, guard.user, entrada)
    return Response.json({ version: r.version, resultado: r.resultado }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
