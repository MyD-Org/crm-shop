import { consultasNominatim, sugerenciasDeNominatim, type SugerenciaDireccion } from "@/lib/nominatim-direcciones"
import { permitirAsync } from "@/lib/rate-limit"
import { NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"

// GET /api/admin/envios/direcciones?q=...&ciudad=...&provincia=... — proxy de Nominatim para la
// "Prueba de dirección" del editor de zonas. Guard de Envíos (operador o superior), rate limit por
// tenant y usuario, User-Agent identificable, caché de una semana por URL y búsqueda acotada a la
// localidad (consulta estructurada + UN reintento; sin ciudad, una consulta libre en Argentina).
// A diferencia del Shop NO firma ningún token: el admin sólo dibuja el punto para probar, no
// decide un precio con él.

const MIN_CARACTERES = 4
const MAX_POR_MINUTO = 30
const CACHE_SEGUNDOS = 60 * 60 * 24 * 7

class NominatimCaido extends Error {}

async function buscar(url: URL): Promise<SugerenciaDireccion[]> {
  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: {
        // La política de Nominatim pide identificarse con un contacto real (env; en desarrollo, un ejemplo).
        "User-Agent": `crm-envios-admin/1.0 (${process.env.GEOCODE_CONTACT_EMAIL ?? "contacto@cliente.example"})`,
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: CACHE_SEGUNDOS },
    } as RequestInit)
  } catch {
    throw new NominatimCaido()
  }
  if (!res.ok) throw new NominatimCaido()
  return sugerenciasDeNominatim(await res.json().catch(() => null))
}

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const params = new URL(req.url).searchParams
  const q = params.get("q")?.trim() ?? ""
  if (q.length < MIN_CARACTERES) return Response.json({ direcciones: [] }, { headers: NO_STORE })

  if (!(await permitirAsync(`envios-dir:${guard.tenantId}:${guard.user.id}`, MAX_POR_MINUTO, 60_000))) {
    return Response.json(
      { error: "Demasiadas búsquedas. Espere un momento.", code: "rate_limited" },
      { status: 429, headers: NO_STORE },
    )
  }

  const [principal, reintento] = consultasNominatim(q, params.get("ciudad"), params.get("provincia"))
  try {
    let direcciones = await buscar(principal)
    // El reintento sólo sale si la consulta estructurada no encontró nada.
    if (direcciones.length === 0 && reintento) direcciones = await buscar(reintento)
    return Response.json({ direcciones }, { headers: NO_STORE })
  } catch {
    return Response.json(
      { error: "No pudimos buscar la dirección. Inténtelo nuevamente.", code: "upstream" },
      { status: 502, headers: NO_STORE },
    )
  }
}
