import { NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { buscarLocalidades, etiquetaLocalidad, GeorefError } from "@/lib/georef"

// GET /api/admin/envios/localidades?q=... — busca localidades en Georef para el selector de
// "Ciudades de envío". Con menos de 4 caracteres devuelve lista vacía. 502 si Georef falla.
// Mismo guard que el resto de Envíos (operador o superior).

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const q = new URL(req.url).searchParams.get("q") ?? ""
  try {
    const lista = await buscarLocalidades(q)
    const localidades = lista.map((s) => ({ id: s.id, nombre: s.localidad, etiqueta: etiquetaLocalidad(s, lista) }))
    return Response.json({ localidades }, { headers: NO_STORE })
  } catch (err) {
    if (!(err instanceof GeorefError)) throw err
    return Response.json(
      { error: "No pudimos buscar las localidades. Inténtelo nuevamente.", code: "upstream" },
      { status: 502, headers: NO_STORE },
    )
  }
}
