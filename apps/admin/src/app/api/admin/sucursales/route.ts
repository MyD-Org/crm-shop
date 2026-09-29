import { crearSucursal, listarSucursales, listarZonas, toSucursalDto, toZonaDto } from "@/lib/sucursales-repo"
import { errorDeResultado, NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// GET  /api/admin/sucursales — sucursales y zonas del tenant.
// POST /api/admin/sucursales — alta de una sucursal (slug inmutable). Tenant = el del guard.
// Tras persistir se avisa al Shop (best-effort): la respuesta trae `propagado`.

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const [suc, zon] = await Promise.all([listarSucursales(guard.tenantId), listarZonas(guard.tenantId)])
  return Response.json({ sucursales: suc.map(toSucursalDto), zonas: zon.map(toZonaDto) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await crearSucursal(guard.tenantId, body)
  if (r.kind === "not_found") return Response.json({ error: "No encontramos el registro indicado." }, { status: 404, headers: NO_STORE })
  if (r.kind !== "ok") return errorDeResultado(r)

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, sucursal: r.sucursal }, { status: 201, headers: NO_STORE })
}
