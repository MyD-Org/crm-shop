import { requireAdminPlus } from "@/lib/admin-route-guard"
import { leerPromocionEntrada } from "@/lib/cupones-http"
import { guardarPromocion, listarPromociones } from "@/lib/cupones-repo"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"

// GET  /api/admin/cupones — { promociones } con estado, códigos emitidos y canjes.
// POST /api/admin/cupones — promoción -> 201 { id }. 400 si no valida; 409 `codigo_repetido`;
// 422 `medio_no_admitido` (cuenta corriente o inexistente).
// admin+ (operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ promociones: await listarPromociones(guard.tenantId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const promocion = leerPromocionEntrada(body)
  if (promocion instanceof Response) return promocion
  try {
    const { id } = await guardarPromocion(guard.tenantId, promocion, guard.user)
    return Response.json({ id }, { status: 201, headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
