import { requireComprasAccess } from "@/lib/admin-route-guard"
import { configAlegraDeCuenta, cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import { buscarProveedores } from "@/lib/compras-proveedores-repo"

// GET /api/admin/compras/proveedores?cuenta=<slug>&q= — proveedores de la cuenta de Alegra elegida
// (espejo de contactos; si el espejo de la cuenta está vacío, lectura en vivo con aviso).

export async function GET(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const slug = url.searchParams.get("cuenta")?.trim() ?? ""
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  try {
    const r = await buscarProveedores(
      guard.tenantId,
      cuenta,
      url.searchParams.get("q") ?? "",
      () => configAlegraDeCuenta(guard.tenantId, cuenta),
    )
    return ok({
      proveedores: r.proveedores,
      aviso: r.enVivo ? "Los contactos de esta cuenta todavía no se sincronizaron: se muestran los resultados leídos de Alegra." : null,
    })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
