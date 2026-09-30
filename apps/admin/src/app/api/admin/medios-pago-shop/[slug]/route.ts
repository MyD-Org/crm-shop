import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { actualizarMedioPago, eliminarMedioPago } from "@/lib/medios-pago-shop-repo"
import { errorDeMedio } from "@/lib/medios-pago-shop-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { NO_STORE } from "@/lib/sucursales-respuestas"

// PATCH  /api/admin/medios-pago-shop/[slug] — cambios parciales (el slug no se modifica).
// DELETE /api/admin/medios-pago-shop/[slug] — sólo si ningún pedido lo eligió; si no, desactivar.
// Admin o superadmin. Tras persistir se avisa al Shop (best-effort).

type Ctx = { params: Promise<{ slug: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const r = await actualizarMedioPago(guard.tenantId, slug, body)
  if (r.kind !== "ok") return errorDeMedio(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, medio: r.medio }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { slug } = await params
  const r = await eliminarMedioPago(guard.tenantId, slug)
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind === "conflict") return Response.json({ error: r.error, code: "conflict" }, { status: 409, headers: NO_STORE })

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
