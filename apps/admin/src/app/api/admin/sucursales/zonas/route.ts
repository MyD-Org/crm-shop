import { guardarZona, listarZonas, toZonaDto } from "@/lib/sucursales-repo"
import { errorDeResultado, NO_STORE, noEncontrado, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// GET  /api/admin/sucursales/zonas — zonas (provincia -> sucursal) del tenant.
// PUT  /api/admin/sucursales/zonas — alta o cambio de la zona de una provincia:
//      { provincia, sucursal, facturaSucursal? }. Los pedidos ya creados no cambian.

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response
  const zonas = await listarZonas(guard.tenantId)
  return Response.json({ zonas: zonas.map(toZonaDto) }, { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await guardarZona(guard.tenantId, body)
  if (r.kind === "not_found") return noEncontrado()
  if (r.kind !== "ok") return errorDeResultado(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, zona: r.zona }, { headers: NO_STORE })
}
