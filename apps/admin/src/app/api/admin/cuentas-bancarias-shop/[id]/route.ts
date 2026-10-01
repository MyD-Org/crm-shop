import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { actualizarCuenta, eliminarCuenta } from "@/lib/cuentas-bancarias-shop-repo"
import { errorDeCuenta } from "@/lib/cuentas-bancarias-shop-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { NO_STORE } from "@/lib/sucursales-respuestas"

// PATCH  /api/admin/cuentas-bancarias-shop/[id] — cambios parciales (se valida la cuenta completa).
// DELETE /api/admin/cuentas-bancarias-shop/[id] — elimina la cuenta (los pedidos conservan su copia).
// Admin o superadmin. Tras persistir se avisa al Shop (best-effort).

type Ctx = { params: Promise<{ id: string }> }

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  if (!ID_RE.test(id)) return adminNotFoundResponse()
  const body = await req.json().catch(() => null)
  const r = await actualizarCuenta(guard.tenantId, id, body)
  if (r.kind !== "ok") return errorDeCuenta(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, cuenta: r.cuenta }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  if (!ID_RE.test(id)) return adminNotFoundResponse()
  const r = await eliminarCuenta(guard.tenantId, id)
  if (r.kind === "not_found") return adminNotFoundResponse()

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
