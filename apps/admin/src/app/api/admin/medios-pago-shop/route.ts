import { requireAdminPlus } from "@/lib/admin-route-guard"
import { crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { NO_STORE } from "@/lib/sucursales-respuestas"
import { errorDeMedio } from "@/lib/medios-pago-shop-respuestas"

// GET  /api/admin/medios-pago-shop — medios de pago del checkout del tenant (activos o no).
// POST /api/admin/medios-pago-shop — alta de un medio (slug inmutable; 409 si ya existe).
// Admin o superadmin. Tenant = el del guard. Tras persistir se avisa al Shop (best-effort): la
// respuesta trae `propagado`.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ medios: await listarMediosPago(guard.tenantId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await crearMedioPago(guard.tenantId, body)
  if (r.kind !== "ok") return errorDeMedio(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, medio: r.medio }, { status: 201, headers: NO_STORE })
}
