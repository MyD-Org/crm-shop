import { requireAdminPlus } from "@/lib/admin-route-guard"
import { leerCampania } from "@/lib/campanias-http"
import { guardarCampania, listarCampanias } from "@/lib/campanias-repo"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"

// GET  /api/admin/campanias — { campanias } con estado (programada / activa / terminada) y productos.
// POST /api/admin/campanias — { nombre, etiqueta?, inicio, fin, reglas } -> 201 { id }. 400 si no
// valida; 409 `campania_superpuesta` si las fechas se pisan con otra; 422 si el fin ya pasó.
// admin+ (operator -> 404). Tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ campanias: await listarCampanias(guard.tenantId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const campania = leerCampania(body)
  if (campania instanceof Response) return campania
  try {
    const { id } = await guardarCampania(guard.tenantId, campania, guard.user)
    return Response.json({ id }, { status: 201, headers: NO_STORE })
  } catch (err) {
    return respuestaDeError(err)
  }
}
