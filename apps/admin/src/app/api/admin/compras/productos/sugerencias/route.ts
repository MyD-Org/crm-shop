import { requireSeccion } from "@/lib/admin-route-guard"
import { cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import { sugerenciasAlta } from "@/lib/compras-producto-sugerencias-repo"

// GET /api/admin/compras/productos/sugerencias?cuenta=&texto=&marca=&proveedor= — campos sugeridos
// para «Crear producto» (marca, sufijo, categoría, IVA, nombre, código), derivados del catálogo y de
// las compras previas del proveedor. Sólo lectura. Guard: rol «compras» o admin+.

export async function GET(req: Request) {
  const guard = await requireSeccion(req, "compras")
  if (!guard.ok) return guard.response
  const url = new URL(req.url)
  const slug = url.searchParams.get("cuenta")?.trim() ?? ""
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  try {
    const s = await sugerenciasAlta(guard.tenantId, { principal: cuenta.principal }, {
      texto: (url.searchParams.get("texto") ?? "").slice(0, 150),
      marca: (url.searchParams.get("marca") ?? "").slice(0, 80),
      proveedorAlegraId: (url.searchParams.get("proveedor") ?? "").slice(0, 60),
    })
    return ok(s)
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
