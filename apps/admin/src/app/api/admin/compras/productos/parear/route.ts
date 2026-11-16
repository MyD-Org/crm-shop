import { requireComprasAccess } from "@/lib/admin-route-guard"
import { parearItemEnCuentaPorCodigo } from "@/lib/alegra-items-cuenta"
import { configAlegraDeCuenta, cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"

// POST /api/admin/compras/productos/parear { cuenta, alegraId } — «Buscar en Alegra»: busca el
// producto por código en la cuenta elegida (SÓLO LECTURA de Alegra) y, si hay una única
// coincidencia, guarda el pareo. No crea nada en Alegra.

export async function POST(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response

  const body = (await req.json().catch(() => null)) as { cuenta?: unknown; alegraId?: unknown } | null
  const slug = typeof body?.cuenta === "string" ? body.cuenta.trim() : ""
  const alegraId = typeof body?.alegraId === "string" ? body.alegraId.trim() : ""
  if (!slug || !alegraId) return fail(400, "validacion", "Indique la cuenta y el producto.")
  const cuenta = await cuentaActivaPorSlug(guard.tenantId, slug)
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  try {
    const config = await configAlegraDeCuenta(guard.tenantId, cuenta)
    const r = await parearItemEnCuentaPorCodigo(
      guard.tenantId,
      config,
      { id: cuenta.id, slug: cuenta.slug, nombre: cuenta.nombre, principal: cuenta.principal },
      alegraId,
    )
    if (!r.ok) return fail(422, "item_inexistente", r.error)
    return ok({ itemIdCuenta: r.id })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
