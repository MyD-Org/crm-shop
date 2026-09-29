import { eliminarZona } from "@/lib/sucursales-repo"
import { errorDeResultado, noEncontrado, NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// DELETE /api/admin/sucursales/zonas/[clave] — quita la zona de una provincia (`provincia_clave`):
// desde ese momento rige la sucursal predeterminada. No afecta pedidos ya creados.

export async function DELETE(req: Request, { params }: { params: Promise<{ clave: string }> }) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const { clave } = await params
  const r = await eliminarZona(guard.tenantId, clave)
  if (r.kind === "not_found") return noEncontrado()
  if (r.kind !== "ok") return errorDeResultado(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
