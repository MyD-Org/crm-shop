/**
 * Centro y rectángulo de las "localidades que atiende" un método de envío (change
 * `envio-por-zona-con-tarifa`). Se completan en el servidor del CRM al guardar, best-effort:
 *  - centro: Georef (`centroide.lat/lon`, confirmado en el endpoint `/localidades`).
 *  - rectángulo: `boundingbox` de Nominatim, consulta ESTRUCTURADA acotada a la localidad y su
 *    provincia. Si falla, la localidad queda sin rectángulo y el estimado no será "exacto" por polígono.
 * Nunca tira: cualquier falla (timeout, 5xx, forma rara) deja el dato en null. Sólo el servidor.
 */
import { CAJA_AR, type Bbox } from "@/lib/geo-poligono"
import { GEOREF_BASE, TIMEOUT_MS } from "@/lib/georef"

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search"
/** Identificable (política de uso de Nominatim) y sin datos de nadie. */
const USER_AGENT = "crm-envios-admin/1.0 (configuracion de zonas de envio)"
/** Las localidades no se mudan: un día de caché. */
const CACHE_SEGUNDOS = 60 * 60 * 24

export interface CentroLocalidad {
  lat: number
  lon: number
}

export interface GeoLocalidad {
  centro: CentroLocalidad | null
  bbox: Bbox | null
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const numero = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? n : null
}
const enCajaAr = (lat: number, lon: number) =>
  lat >= CAJA_AR.latMin && lat <= CAJA_AR.latMax && lon >= CAJA_AR.lonMin && lon <= CAJA_AR.lonMax

async function pedirJson(url: URL, f: typeof fetch, headers?: Record<string, string>): Promise<unknown> {
  try {
    const res = await f(url.toString(), {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: CACHE_SEGUNDOS },
    } as RequestInit)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

interface DatosGeoref {
  nombre: string | null
  provincia: string | null
  centro: CentroLocalidad | null
}

async function leerGeoref(georefId: string, f: typeof fetch): Promise<DatosGeoref | null> {
  const url = new URL(`${GEOREF_BASE}/localidades`)
  url.searchParams.set("id", georefId)
  url.searchParams.set("max", "1")
  url.searchParams.set("campos", "id,nombre,provincia.nombre,centroide.lat,centroide.lon")
  const lista = objeto(await pedirJson(url, f))?.localidades
  const l = Array.isArray(lista) ? objeto(lista[0]) : null
  if (!l) return null
  const c = objeto(l.centroide)
  const lat = c ? numero(c.lat) : null
  const lon = c ? numero(c.lon) : null
  return {
    nombre: typeof l.nombre === "string" ? l.nombre : null,
    provincia: typeof objeto(l.provincia)?.nombre === "string" ? (objeto(l.provincia)!.nombre as string) : null,
    centro: lat !== null && lon !== null && enCajaAr(lat, lon) ? { lat, lon } : null,
  }
}

async function leerBbox(nombre: string, provincia: string | null, f: typeof fetch): Promise<Bbox | null> {
  const url = new URL(NOMINATIM_BASE)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "1")
  url.searchParams.set("countrycodes", "ar")
  url.searchParams.set("city", nombre)
  if (provincia) url.searchParams.set("state", provincia)
  const datos = await pedirJson(url, f, { "User-Agent": USER_AGENT, Accept: "application/json" })
  const primero = Array.isArray(datos) ? objeto(datos[0]) : null
  const caja = primero?.boundingbox
  if (!Array.isArray(caja) || caja.length !== 4) return null
  const [sur, norte, oeste, este] = caja.map(numero)
  if (sur === null || norte === null || oeste === null || este === null) return null
  if (!enCajaAr(sur, oeste) || !enCajaAr(norte, este) || sur > norte || oeste > este) return null
  return { sur, norte, oeste, este }
}

export async function completarLocalidad(georefId: string, f: typeof fetch = fetch): Promise<GeoLocalidad> {
  const g = await leerGeoref(georefId, f)
  if (!g || !g.nombre) return { centro: null, bbox: null }
  const bbox = await leerBbox(g.nombre, g.provincia, f)
  const centro = g.centro ?? (bbox ? { lat: (bbox.sur + bbox.norte) / 2, lon: (bbox.oeste + bbox.este) / 2 } : null)
  return { centro, bbox }
}

/** Completa las localidades de a una (Nominatim pide ritmo bajo). */
export async function completarLocalidades<T extends { georefId: string }>(
  locs: T[],
  f: typeof fetch = fetch,
): Promise<(T & GeoLocalidad)[]> {
  const salida: (T & GeoLocalidad)[] = []
  for (const l of locs) salida.push({ ...l, ...(await completarLocalidad(l.georefId, f)) })
  return salida
}
