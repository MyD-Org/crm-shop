import { requireAdminPlus } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { validarCambios } from "@/lib/precios-online-cambios"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"
import { previsualizar } from "@/lib/precios-online-repo"

// POST /api/admin/precios-online/previsualizar — { cambios: [...] }.
// Aplica los cambios dentro de una transacción y los DESHACE: no modifica ningún precio, lista ni
// historial. Devuelve el resumen (afectados, suben/bajan, mayor suba/baja, sin costo excluidos,
// muestra, advertencias) y las claves (baseVersion, huella) que `aplicar` exige.
// admin+ (requireAdminPlus: operator -> 404). Tenant = el del guard.

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const v = validarCambios(body.cambios)
  if (!v.ok) return invalidResponse(v.error, v.campo)
  try {
    return Response.json({ previa: await previsualizar(guard.tenantId, v.cambios) }, { headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
