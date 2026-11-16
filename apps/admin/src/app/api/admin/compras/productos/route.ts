import { requireComprasAccess } from "@/lib/admin-route-guard"
import { cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import { buscarProductosCompra } from "@/lib/compras-productos-repo"

// GET /api/admin/compras/productos?cuenta=<slug>&q= — productos del catálogo con su ítem en la
// cuenta elegida (`itemIdCuenta`) o `sinItemEnCuenta`. Incluye el costo de referencia: sólo se
// llega acá tras `requireComprasAccess` (rol «compras», admin o superadmin).

export async function GET(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const slug = url.searchParams.get("cuenta")?.trim() ?? ""
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  try {
    const productos = await buscarProductosCompra(
      guard.tenantId,
      { id: cuenta.id, slug: cuenta.slug, nombre: cuenta.nombre, principal: cuenta.principal },
      url.searchParams.get("q") ?? "",
    )
    return ok({ productos })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
