/**
 * Consultas a Nominatim para la "Prueba de dirección" del admin (change `envio-por-zona-con-tarifa`).
 * Puro: arma las URLs y normaliza la respuesta; el fetch vive en la ruta. Misma lógica de búsqueda
 * acotada a la localidad que usará el Shop (consulta estructurada con el número al frente y UN
 * reintento por `q=`; sin ciudad, una consulta libre acotada a Argentina; nunca cae a una búsqueda
 * nacional cuando hay ciudad).
 */
import { CAJA_AR } from "@/lib/geo-poligono"

const BASE = "https://nominatim.openstreetmap.org/search"
const LIMITE = 6

export interface SugerenciaDireccion {
  label: string
  calle: string
  ciudad: string
  provincia: string
  cp: string
  lat: number
  lon: number
  precision: "altura" | "calle"
}

function urlBase(): URL {
  const u = new URL(BASE)
  u.searchParams.set("format", "json")
  u.searchParams.set("addressdetails", "1")
  u.searchParams.set("limit", String(LIMITE))
  u.searchParams.set("countrycodes", "ar")
  u.searchParams.set("accept-language", "es")
  return u
}

/** "Av. Colón 2500" → "2500 Av. Colón" (Nominatim estructurado espera el número al frente). */
function numeroAlFrente(calle: string): string {
  const m = /^(.*?)[\s,]+(\d{1,5})\s*$/.exec(calle.trim())
  return m && m[1].trim() ? `${m[2]} ${m[1].trim()}` : calle.trim()
}

/**
 * [consulta principal, reintento?]. En minúsculas: la caché es por URL, así "Colón" y "colón"
 * comparten entrada.
 */
export function consultasNominatim(texto: string, ciudad: string | null, provincia: string | null): URL[] {
  const t = texto.trim().toLowerCase()
  const c = ciudad?.trim().toLowerCase()
  const p = provincia?.trim().toLowerCase()
  if (!c) {
    const u = urlBase()
    u.searchParams.set("q", t)
    return [u]
  }
  const estructurada = urlBase()
  estructurada.searchParams.set("street", numeroAlFrente(t))
  estructurada.searchParams.set("city", c)
  if (p) estructurada.searchParams.set("state", p)
  const libre = urlBase()
  libre.searchParams.set("q", [t, c, p].filter(Boolean).join(", "))
  return [estructurada, libre]
}

function limpiarNombre(v: unknown): string {
  if (typeof v !== "string") return ""
  return v
    .replace(/^(Municipio|Partido|Departamento|Provincia|Comuna|Estado)\s+(de|do|da)\s+/i, "")
    .replace(/^Municipio\s+/i, "")
    .trim()
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "")

/** Sugerencias con coordenadas; descarta las que no tienen punto válido dentro de Argentina. */
export function sugerenciasDeNominatim(data: unknown): SugerenciaDireccion[] {
  if (!Array.isArray(data)) return []
  const salida: SugerenciaDireccion[] = []
  for (const r of data) {
    if (!r || typeof r !== "object") continue
    const { lat, lon, address } = r as { lat?: unknown; lon?: unknown; address?: Record<string, unknown> }
    const la = Number(lat)
    const lo = Number(lon)
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
    if (la < CAJA_AR.latMin || la > CAJA_AR.latMax || lo < CAJA_AR.lonMin || lo > CAJA_AR.lonMax) continue
    const a = address ?? {}
    const calle = [texto(a.road), texto(a.house_number)].filter(Boolean).join(" ")
    const ciudad = limpiarNombre(a.city ?? a.town ?? a.village)
    const provincia = limpiarNombre(a.state)
    salida.push({
      label: [calle, ciudad, provincia].filter(Boolean).join(", "),
      calle,
      ciudad,
      provincia,
      cp: texto(a.postcode),
      lat: la,
      lon: lo,
      precision: texto(a.house_number) ? "altura" : "calle",
    })
  }
  return salida
}
