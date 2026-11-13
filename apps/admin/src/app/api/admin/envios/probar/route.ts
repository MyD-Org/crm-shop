import { CAJA_AR } from "@/lib/geo-poligono"
import type { MetodoEnvio } from "@/lib/envio-zona"
import { completarLocalidad } from "@/lib/metodos-envio-localidades"
import { metodoDeBorrador, probarDireccion, probarLocalidad } from "@/lib/metodos-envio-probar"
import { leerMetodoPuro } from "@/lib/metodos-envio-repo"
import { validarMetodoEnvio } from "@/lib/metodos-envio-validacion"
import { noEncontrado, NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"

// POST /api/admin/envios/probar — "Prueba de dirección" del editor de zonas. Corre las MISMAS
// funciones que decidirán en el Shop (`resolverZona`/`estimarPorLocalidad`/`fechaEntrega`) sobre un
// método guardado (`metodoId`, del tenant del guard) o sobre el borrador en edición (`metodo`).
//   modo "direccion": { punto: {lat, lon, precision}, cp? } → zona, regla, precio, promesa y entrega.
//   modo "localidad": { georefId } → precio estimado (exacto | desde).
// No escribe nada. Mismo guard que el resto de Envíos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const invalido = (error: string, campo?: string) =>
  Response.json({ error, code: "invalid", campo }, { status: 400, headers: NO_STORE })

export async function POST(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return invalido("Los datos de la prueba no son válidos.")
  const b = body as Record<string, unknown>
  if (b.modo !== "direccion" && b.modo !== "localidad") return invalido("Seleccione el tipo de prueba.", "modo")

  // Método: el borrador en edición o uno guardado del tenant.
  let metodo: MetodoEnvio
  if (b.metodo !== undefined) {
    const v = validarMetodoEnvio(b.metodo && typeof b.metodo === "object" ? { ...(b.metodo as object), activo: false } : b.metodo)
    if (!v.ok) return invalido(v.error, v.campo)
    metodo = metodoDeBorrador(v.metodo)
  } else {
    if (typeof b.metodoId !== "string" || !UUID.test(b.metodoId)) return invalido("Seleccione el método a probar.", "metodoId")
    const guardado = await leerMetodoPuro(guard.tenantId, b.metodoId.toLowerCase())
    if (!guardado) return noEncontrado()
    metodo = guardado
  }

  if (b.modo === "localidad") {
    if (typeof b.georefId !== "string" || !/^[0-9]{1,12}$/.test(b.georefId.trim())) {
      return invalido("Seleccione la localidad de la lista.", "georefId")
    }
    return Response.json(await probarLocalidad(metodo, b.georefId.trim(), completarLocalidad), { headers: NO_STORE })
  }

  const p = b.punto as { lat?: unknown; lon?: unknown; precision?: unknown } | undefined
  const lat = typeof p?.lat === "number" ? p.lat : NaN
  const lon = typeof p?.lon === "number" ? p.lon : NaN
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < CAJA_AR.latMin ||
    lat > CAJA_AR.latMax ||
    lon < CAJA_AR.lonMin ||
    lon > CAJA_AR.lonMax
  ) {
    return invalido("Seleccione una dirección de la lista para ubicarla en el mapa.", "punto")
  }
  const cp = typeof b.cp === "string" && b.cp.trim() ? b.cp.trim().slice(0, 12) : null
  const resultado = probarDireccion(
    metodo,
    { punto: { lat, lon, precision: p?.precision === "calle" ? "calle" : "altura" }, cp },
    new Date(),
  )
  return Response.json(resultado, { headers: NO_STORE })
}
