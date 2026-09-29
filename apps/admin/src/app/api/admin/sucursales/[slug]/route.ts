import { actualizarSucursal, eliminarSucursal } from "@/lib/sucursales-repo"
import { errorDeResultado, noEncontrado, NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// PATCH  /api/admin/sucursales/[slug] — cambios parciales (el slug no se modifica). Marcar
//        `predeterminada` o `maestra` transfiere la marca de forma atómica.
// DELETE /api/admin/sucursales/[slug] — sólo si ningún pedido ni zona la usa; si no, desactivar.

type Ctx = { params: Promise<{ slug: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const r = await actualizarSucursal(guard.tenantId, slug, body)
  if (r.kind === "not_found") return noEncontrado()
  if (r.kind !== "ok") return errorDeResultado(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, sucursal: r.sucursal }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const { slug } = await params
  const r = await eliminarSucursal(guard.tenantId, slug)
  if (r.kind === "not_found") return noEncontrado()
  if (r.kind !== "ok") return errorDeResultado(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
