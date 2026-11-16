import { requireComprasAccess } from "@/lib/admin-route-guard"
import { configAlegraDeCuenta, cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import { crearProductoCompra, datosParaCopia, listasParaAlta, validarEntradaAlta } from "@/lib/compras-producto-alta"

// Alta de un producto NUEVO desde Compras (change `compras-en-transito`, S4b). Escribe en Alegra sólo
// en la cuenta de la compra y sólo con `confirmar: true`. Guard: rol «compras» o admin+.
//
// GET  ?cuenta=<slug>&costo=<n>   (o &alegraId=<id> para tomar el costo del catálogo): listas de la
//                                 cuenta con su % por defecto y el precio resultante. Sólo lectura.
// POST { cuenta, nombre, codigoProveedor, marca, sufijoMarca, categoriaId?, unidad, ivaPorcentaje,
//        costo, precios: [{id, precio}], confirmar }

export async function GET(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response
  const url = new URL(req.url)
  const slug = url.searchParams.get("cuenta")?.trim() ?? ""
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  try {
    const alegraId = url.searchParams.get("alegraId")?.trim()
    let costo = Number((url.searchParams.get("costo") ?? "").replace(",", "."))
    if (alegraId) {
      const datos = await datosParaCopia(guard.tenantId, alegraId)
      if (!datos) return fail(404, "producto_inexistente", "El producto ya no está en el catálogo.")
      if (datos.costo === null || datos.costo <= 0) {
        return fail(422, "sin_costo", `El producto "${datos.name}" no tiene costo en el catálogo: no se pueden calcular sus listas de precio.`)
      }
      costo = datos.costo
    }
    if (!Number.isFinite(costo) || costo <= 0) return fail(400, "validacion", "Indique un costo mayor a cero.")
    const config = await configAlegraDeCuenta(guard.tenantId, cuenta)
    const listas = await listasParaAlta(config, cuenta, costo)
    return ok({ costo, listas })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}

export async function POST(req: Request) {
  const guard = await requireComprasAccess(req)
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  try {
    const entrada = validarEntradaAlta(body)
    const cuenta = await cuentaActivaPorSlug(guard.tenantId, entrada.cuenta)
    if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
    const config = await configAlegraDeCuenta(guard.tenantId, cuenta)
    const r = await crearProductoCompra(
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
