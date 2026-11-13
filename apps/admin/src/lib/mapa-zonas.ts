/**
 * Lógica pura del mapa de zonas de envío (change `envio-por-zona-con-tarifa`): conversión entre el
 * GeoJSON [lon, lat] que se guarda y los [lat, lng] de Leaflet, importación/exportación de GeoJSON
 * y datos de presentación. Sin Leaflet ni DOM: se prueba en unit (jsdom no renderiza mapas).
 */
import { bboxDe, validarGeometria, type Anillo, type Geometria, type Poligono, type ResultadoGeometria } from "@/lib/geo-poligono"

export type LatLngTupla = [number, number]
export interface LatLngLike {
  lat: number
  lng: number
}

/** Colores de las zonas (se repiten si hay más zonas que colores). */
export const COLORES_ZONA = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"] as const

export function colorDeZona(indice: number): string {
  const n = COLORES_ZONA.length
  return COLORES_ZONA[((indice % n) + n) % n]
}

/** Anillo GeoJSON (cerrado, [lon, lat]) → anillo de Leaflet (abierto, [lat, lng]). */
function anilloALeaflet(anillo: Anillo): LatLngTupla[] {
  const abierto = anillo.length > 1 && anillo[0][0] === anillo[anillo.length - 1][0] && anillo[0][1] === anillo[anillo.length - 1][1] ? anillo.slice(0, -1) : anillo
  return abierto.map(([lon, lat]) => [lat, lon])
}

/** Geometría guardada → `polígono[ anillo[ [lat, lng] ] ]` por cada polígono, para `L.polygon`. */
export function geometriaALatLngs(g: Geometria): LatLngTupla[][][] {
  return g.map((poligono) => poligono.map(anilloALeaflet))
}

const esLatLng = (v: unknown): v is LatLngLike =>
  typeof v === "object" && v !== null && typeof (v as LatLngLike).lat === "number" && typeof (v as LatLngLike).lng === "number"

function aAnillo(puntos: LatLngLike[]): Anillo {
  const anillo: Anillo = puntos.map((p) => [p.lng, p.lat])
  const [primero] = anillo
  const ultimo = anillo[anillo.length - 1]
  if (primero && (primero[0] !== ultimo[0] || primero[1] !== ultimo[1])) anillo.push([primero[0], primero[1]])
  return anillo
}

/**
 * `getLatLngs()` de las capas de Leaflet → geometría. Cada elemento de `capas` es lo que devuelve
 * una capa: `anillo[]` (polígono simple, con huecos) o `polígono[]` (multipolígono tras un corte).
 * Descarta anillos con menos de 3 puntos.
 */
export function latLngsAGeometria(capas: unknown[]): Geometria {
  const salida: Geometria = []
  for (const cruda of capas) {
    if (!Array.isArray(cruda)) continue
    // Un anillo suelto (lista de puntos) se trata como un polígono sin huecos.
    const capa: unknown[] = cruda.length > 0 && esLatLng(cruda[0]) ? [cruda] : cruda
    // Profundidad: [LatLng] = anillo suelto, [[LatLng]] = polígono, [[[LatLng]]] = multi.
    const primero = capa.find((x) => Array.isArray(x)) as unknown[] | undefined
    const esMulti = Array.isArray(primero) && primero.some((x) => Array.isArray(x))
    const poligonos: unknown[][][] = esMulti ? (capa as unknown[][][]) : [capa as unknown[][]]
    for (const rings of poligonos) {
      const anillos: Poligono = []
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue
        const puntos = ring.filter(esLatLng)
        if (puntos.length >= 3) anillos.push(aAnillo(puntos))
      }
      if (anillos.length > 0) salida.push(anillos)
    }
  }
  return salida
}

export function geometriaAGeojson(g: Geometria, nombre?: string) {
  return {
    type: "Feature" as const,
    properties: nombre ? { nombre } : {},
    geometry: { type: "MultiPolygon" as const, coordinates: g },
  }
}

const NO_ES_POLIGONO = "El archivo no contiene polígonos válidos. Importe un GeoJSON de tipo Polygon o MultiPolygon."

function poligonosDe(nodo: unknown, salida: Geometria, nivel = 0): boolean {
  if (typeof nodo !== "object" || nodo === null || nivel > 4) return false
  const n = nodo as { type?: unknown; coordinates?: unknown; geometry?: unknown; features?: unknown }
  if (n.type === "Polygon" && Array.isArray(n.coordinates)) {
    salida.push(n.coordinates as Poligono)
    return true
  }
  if (n.type === "MultiPolygon" && Array.isArray(n.coordinates)) {
    salida.push(...(n.coordinates as Geometria))
    return true
  }
  if (n.type === "Feature") return poligonosDe(n.geometry, salida, nivel + 1)
  if (n.type === "FeatureCollection" && Array.isArray(n.features)) {
    let alguno = false
    for (const f of n.features) alguno = poligonosDe(f, salida, nivel + 1) || alguno
    return alguno
  }
  return false
}

/** GeoJSON (objeto o texto) → geometría validada (cerrada, en la caja de Argentina, sin cruces). */
export function geojsonAGeometria(entrada: unknown): ResultadoGeometria {
  let json = entrada
  if (typeof entrada === "string") {
    try {
      json = JSON.parse(entrada)
    } catch {
      return { ok: false, error: "El archivo no es un GeoJSON válido." }
    }
  }
  const g: Geometria = []
  if (!poligonosDe(json, g) || g.length === 0) return { ok: false, error: NO_ES_POLIGONO }
  return validarGeometria(g)
}

/** Centro y zoom iniciales: lo dibujado, o la Argentina entera si todavía no hay nada. */
export function vistaInicial(geometrias: Geometria[]): { centro: LatLngTupla; zoom: number } {
  const dibujadas = geometrias.flat()
  if (dibujadas.length === 0) return { centro: [-38.4, -63.6], zoom: 4 }
  const b = bboxDe(dibujadas)
  const span = Math.max(b.norte - b.sur, b.este - b.oeste)
  const zoom = span > 4 ? 6 : span > 1 ? 9 : span > 0.3 ? 11 : span > 0.1 ? 12 : 13
  return { centro: [(b.sur + b.norte) / 2, (b.oeste + b.este) / 2], zoom }
}
