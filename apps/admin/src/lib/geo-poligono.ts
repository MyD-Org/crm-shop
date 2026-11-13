/**
 * Geometría de zonas de envío (change `envio-por-zona-con-tarifa`). Módulo PURO, sin dependencias.
 *
 * Una geometría es el `coordinates` de un GeoJSON MultiPolygon: `[ polígono, … ]`, con cada
 * polígono `[ anillo exterior, huecos… ]` y cada anillo `[ [lon, lat], … ]` cerrado. El orden es
 * [lon, lat] (GeoJSON), pero las funciones de consulta reciben `(lat, lon)` como el resto del código.
 *
 * El Shop tiene una copia idéntica (`apps/clientes/src/lib/geo-poligono.ts`; no hay paquetes
 * compartidos) y las dos ejecutan el MISMO fixture (`__fixtures__/envio-zona-casos.json`).
 * Si cambia una, cambia la otra.
 *
 * Convención de borde: un punto sobre el borde de un polígono cuenta como DENTRO (zonas contiguas
 * no dejan franjas sin cubrir; si dos zonas lo comparten, gana la de menor `orden`). El borde de
 * un hueco pertenece al polígono.
 */

export type Punto = [number, number]
export type Anillo = Punto[]
export type Poligono = Anillo[]
export type Geometria = Poligono[]
export interface Bbox {
  sur: number
  oeste: number
  norte: number
  este: number
}

/** Caja que contiene a Argentina (la misma que `CAJA_ARGENTINA` de georef.ts). */
export const CAJA_AR = { latMin: -56, latMax: -21, lonMin: -74, lonMax: -53 } as const
export const MAX_POLIGONOS = 20
export const MAX_VERTICES = 1000

const EPS = 1e-12

/** Orientación de c respecto del segmento a→b: >0 izquierda, <0 derecha, 0 colineal. */
function cruz(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function enSegmento(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  if (Math.abs(cruz(ax, ay, bx, by, px, py)) > EPS) return false
  return (
    px >= Math.min(ax, bx) - EPS && px <= Math.max(ax, bx) + EPS && py >= Math.min(ay, by) - EPS && py <= Math.max(ay, by) + EPS
  )
}

/** -1 fuera, 0 sobre el borde, 1 dentro. Trabaja en (x = lon, y = lat). */
function posicionEnAnillo(lat: number, lon: number, anillo: Anillo): -1 | 0 | 1 {
  let dentro = false
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i]
    const [xj, yj] = anillo[j]
    if (enSegmento(xj, yj, xi, yi, lon, lat)) return 0
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro ? 1 : -1
}

function enPoligono(lat: number, lon: number, poligono: Poligono): boolean {
  if (poligono.length === 0) return false
  if (posicionEnAnillo(lat, lon, poligono[0]) < 0) return false
  for (let h = 1; h < poligono.length; h++) {
    if (posicionEnAnillo(lat, lon, poligono[h]) > 0) return false
  }
  return true
}

/** ¿El punto está dentro de la geometría? (Los huecos restan; el borde cuenta como dentro.) */
export function puntoEnGeometria(lat: number, lon: number, g: Geometria): boolean {
  return g.some((poligono) => enPoligono(lat, lon, poligono))
}

export function bboxDe(g: Geometria): Bbox {
  let sur = Infinity
  let oeste = Infinity
  let norte = -Infinity
  let este = -Infinity
  for (const poligono of g) {
    for (const anillo of poligono) {
      for (const [lon, lat] of anillo) {
        if (lat < sur) sur = lat
        if (lat > norte) norte = lat
        if (lon < oeste) oeste = lon
        if (lon > este) este = lon
      }
    }
  }
  return { sur, oeste, norte, este }
}

export function bboxInterseca(a: Bbox, b: Bbox): boolean {
  return a.oeste <= b.este && b.oeste <= a.este && a.sur <= b.norte && b.sur <= a.norte
}

function segmentosSeCortan(a: Punto, b: Punto, c: Punto, d: Punto, soloCruceLimpio: boolean): boolean {
  const o1 = cruz(a[0], a[1], b[0], b[1], c[0], c[1])
  const o2 = cruz(a[0], a[1], b[0], b[1], d[0], d[1])
  const o3 = cruz(c[0], c[1], d[0], d[1], a[0], a[1])
  const o4 = cruz(c[0], c[1], d[0], d[1], b[0], b[1])
  const limpio = ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))
  if (limpio) return true
  if (soloCruceLimpio) return false
  return (
    enSegmento(a[0], a[1], b[0], b[1], c[0], c[1]) ||
    enSegmento(a[0], a[1], b[0], b[1], d[0], d[1]) ||
    enSegmento(c[0], c[1], d[0], d[1], a[0], a[1]) ||
    enSegmento(c[0], c[1], d[0], d[1], b[0], b[1])
  )
}

function aristasDeBbox(r: Bbox): [Punto, Punto][] {
  const so: Punto = [r.oeste, r.sur]
  const se: Punto = [r.este, r.sur]
  const ne: Punto = [r.este, r.norte]
  const no: Punto = [r.oeste, r.norte]
  return [[so, se], [se, ne], [ne, no], [no, so]]
}

function esquinasDe(r: Bbox): Punto[] {
  return [[r.oeste, r.sur], [r.este, r.sur], [r.este, r.norte], [r.oeste, r.norte]]
}

function enRect(lat: number, lon: number, r: Bbox): boolean {
  return lat >= r.sur && lat <= r.norte && lon >= r.oeste && lon <= r.este
}

/** ¿La geometría toca el rectángulo? (vértice en r | esquina de r en g | cruce de aristas) */
export function geometriaInterseca(g: Geometria, r: Bbox): boolean {
  const aristas = aristasDeBbox(r)
  for (const poligono of g) {
    for (const anillo of poligono) {
      for (const [lon, lat] of anillo) if (enRect(lat, lon, r)) return true
    }
  }
  for (const [lon, lat] of esquinasDe(r)) if (puntoEnGeometria(lat, lon, g)) return true
  for (const poligono of g) {
    for (const anillo of poligono) {
      for (let i = 0; i < anillo.length - 1; i++) {
        for (const [c, d] of aristas) if (segmentosSeCortan(anillo[i], anillo[i + 1], c, d, false)) return true
      }
    }
  }
  return false
}

/**
 * ¿El rectángulo cabe entero en la geometría? Las 4 esquinas dentro, ninguna arista que lo cruce y
 * ningún hueco asomando adentro. Es una verificación conservadora para estimar "exacto".
 */
export function bboxContenidoEn(r: Bbox, g: Geometria): boolean {
  const esquinas = esquinasDe(r)
  const aristas = aristasDeBbox(r)
  for (const poligono of g) {
    if (!esquinas.every(([lon, lat]) => enPoligono(lat, lon, poligono))) continue
    let limpio = true
    for (let a = 0; a < poligono.length && limpio; a++) {
      const anillo = poligono[a]
      for (let i = 0; i < anillo.length - 1 && limpio; i++) {
        for (const [c, d] of aristas) {
          if (segmentosSeCortan(anillo[i], anillo[i + 1], c, d, true)) {
            limpio = false
            break
          }
        }
      }
      if (limpio && a > 0) {
        for (const [lon, lat] of anillo) {
          if (lat > r.sur && lat < r.norte && lon > r.oeste && lon < r.este) {
            limpio = false
            break
          }
        }
      }
    }
    if (limpio) return true
  }
  return false
}

export type ResultadoGeometria = { ok: true; g: Geometria } | { ok: false; error: string }

const falla = (error: string): ResultadoGeometria => ({ ok: false, error })

function esPunto(v: unknown): v is Punto {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n))
}

/** Cruces entre aristas NO contiguas de un anillo (O(n²)). */
function anilloAutointersecado(anillo: Anillo): boolean {
  const n = anillo.length - 1 // aristas
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const contiguas = j === i + 1 || (i === 0 && j === n - 1)
      if (contiguas) continue
      if (segmentosSeCortan(anillo[i], anillo[i + 1], anillo[j], anillo[j + 1], false)) return true
    }
  }
  return false
}

function anillosSeCruzan(a: Anillo, b: Anillo): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentosSeCortan(a[i], a[i + 1], b[j], b[j + 1], true)) return true
    }
  }
  return false
}

/**
 * Valida lo que llega del navegador antes de guardarlo: estructura, anillos cerrados de ≥4 puntos,
 * coordenadas finitas dentro de la caja de Argentina, ≤20 polígonos, ≤1000 vértices en total y sin
 * autointersecciones. Una geometría vacía es válida (la zona puede vivir de sus entradas de
 * respaldo; eso lo exige la validación del método). Los mensajes se muestran al operador (usted).
 */
export function validarGeometria(g: unknown): ResultadoGeometria {
  if (!Array.isArray(g)) return falla("La geometría de la zona no es válida.")
  if (g.length > MAX_POLIGONOS) return falla(`Una zona admite hasta ${MAX_POLIGONOS} polígonos. Simplifique el dibujo.`)
  let vertices = 0
  for (const poligono of g) {
    if (!Array.isArray(poligono) || poligono.length === 0) return falla("Cada polígono debe tener un contorno exterior.")
    for (const anillo of poligono) {
      if (!Array.isArray(anillo) || anillo.length === 0) return falla("Hay un contorno vacío en la zona.")
      vertices += anillo.length
      if (vertices > MAX_VERTICES) return falla(`Una zona admite hasta ${MAX_VERTICES} vértices. Simplifique el dibujo.`)
      for (const punto of anillo) {
        if (!esPunto(punto)) return falla("Hay coordenadas no numéricas en el dibujo de la zona.")
        const [lon, lat] = punto
        if (lat < CAJA_AR.latMin || lat > CAJA_AR.latMax || lon < CAJA_AR.lonMin || lon > CAJA_AR.lonMax) {
          return falla("Hay puntos fuera de la Argentina en el dibujo de la zona.")
        }
      }
      if (anillo.length < 4) return falla("Cada contorno necesita al menos 3 puntos distintos.")
      const primero = anillo[0] as Punto
      const ultimo = anillo[anillo.length - 1] as Punto
      if (primero[0] !== ultimo[0] || primero[1] !== ultimo[1]) return falla("Cada contorno debe estar cerrado.")
    }
  }
  for (const poligono of g as Geometria) {
    for (const anillo of poligono) {
      if (anilloAutointersecado(anillo)) return falla("El contorno de la zona se cruza consigo mismo. Corrija el dibujo.")
    }
    for (let a = 0; a < poligono.length; a++) {
      for (let b = a + 1; b < poligono.length; b++) {
        if (anillosSeCruzan(poligono[a], poligono[b])) return falla("Un hueco cruza el contorno de la zona. Corrija el dibujo.")
      }
    }
  }
  return { ok: true, g: g as Geometria }
}
