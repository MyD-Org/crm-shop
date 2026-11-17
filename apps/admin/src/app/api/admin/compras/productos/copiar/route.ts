import { requireSeccion } from "@/lib/admin-route-guard"
import { configAlegraDeCuenta, cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import { copiarProductoACuenta, validarEntradaCopia } from "@/lib/compras-producto-alta"

// POST /api/admin/compras/productos/copiar { cuenta, alegraId, precios: [{id, precio}], confirmar }
// «Copiar a <cuenta>»: crea en la cuenta de la compra un producto que ya está en el catálogo, con la
// regla de copia de la facturación. Sólo con `confirmar: true`. Guard: rol «compras» o admin+.

export async function POST(req: Request) {
  const guard = await requireSeccion(req, "compras")
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  try {
    const entrada = validarEntradaCopia(body)
    const cuenta = await cuentaActivaPorSlug(guard.tenantId, entrada.cuenta)
    if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
    const config = await configAlegraDeCuenta(guard.tenantId, cuenta)
    const r = await copiarProductoACuenta(
      guard.tenantId,
      { id: cuenta.id, slug: cuenta.slug, nombre: cuenta.nombre, principal: cuenta.principal },
      config,
      entrada,
    )
    return ok(r, r.yaExistia ? 200 : 201)
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
