import { slugReservadoEnAlta } from "@/lib/medios-pago-shop-validacion"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { conAvisos, crearMedioPago, listarMediosPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { NO_STORE } from "@/lib/sucursales-respuestas"
import { errorDeMedio } from "@/lib/medios-pago-shop-respuestas"

// GET  /api/admin/medios-pago-shop — medios de pago del checkout del tenant (activos o no).
//      Cada medio trae `avisos` (no bloqueantes) y la respuesta `listas`: las listas de precios de la
//      cuenta principal de Alegra, para el selector, y `listaReferencia` (la que rige sin lista).
// POST /api/admin/medios-pago-shop — alta de un medio (slug inmutable; 409 si ya existe).
// Admin o superadmin. Tenant = el del guard. Tras persistir se avisa al Shop (best-effort): la
// respuesta trae `propagado`.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { medios, listas, listaReferencia } = await listarMediosPagoConAvisos(guard.tenantId)
  return Response.json({ medios, listas, listaReferencia }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const reservado = slugReservadoEnAlta(body)
  if (reservado) return errorDeMedio({ kind: "invalid", campo: reservado.campo, error: reservado.error })
  const r = await crearMedioPago(guard.tenantId, body)
  if (r.kind !== "ok") return errorDeMedio(r)

  const { propagado } = await pingShopRevalidarSucursales()
  const [medio] = await conAvisos(guard.tenantId, [r.medio])
  return Response.json({ ok: true, propagado, medio }, { status: 201, headers: NO_STORE })
}
