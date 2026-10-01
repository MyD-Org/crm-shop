import { requireAdminPlus } from "@/lib/admin-route-guard"
import { crearCuenta, listarCuentas } from "@/lib/cuentas-bancarias-shop-repo"
import { errorDeCuenta } from "@/lib/cuentas-bancarias-shop-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { NO_STORE } from "@/lib/sucursales-respuestas"

// GET  /api/admin/cuentas-bancarias-shop — cuentas bancarias del tenant (activas o no).
// POST /api/admin/cuentas-bancarias-shop — alta de una cuenta (409 si el CBU ya existe).
// Admin o superadmin. Tenant = el del guard. Tras persistir se avisa al Shop (best-effort): la
// respuesta trae `propagado`.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ cuentas: await listarCuentas(guard.tenantId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await crearCuenta(guard.tenantId, body)
  if (r.kind !== "ok") return errorDeCuenta(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, cuenta: r.cuenta }, { status: 201, headers: NO_STORE })
}
