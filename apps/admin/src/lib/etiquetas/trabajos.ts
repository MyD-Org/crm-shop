/**
 * Trabajos TSPL de etiquetas (puros, sin DOM). El 29x20 es un port de
 * `scripts/etiquetas/codigos.ts` (mismas posiciones y comandos); el QR 6 por hoja se arma acá
 * como layout + ensamble de bitmaps, y el dibujo en canvas vive aparte.
 */
import { ascii, cabeceraTspl, comandoBitmap, concatenar, rgbaA1bit, type OpcionesCabecera } from "./bitmap"
import { barras, code128b, MAX_CARACTERES_REFERENCIA, PUNTOS_POR_MM, validarReferencia } from "./code128"
import { hostWeb, urlProductoQr } from "./qr"
import { textoImprimible, validarCantidad } from "./texto"

export type TipoEtiqueta = "codigos-29x20" | "qr-6up" | "grande"

export interface ItemEtiqueta {
  alegraId: string
  referencia: string | null
  nombre: string
  cantidad: number
}

export interface Omitido {
  alegraId: string
  nombre: string
  motivo: string
}

/** Un flujo de bytes que se manda de una vez a la impresora. */
export interface Trabajo {
  tipo: TipoEtiqueta
  datos: Uint8Array
  etiquetas: number
}

export interface ResultadoTrabajos {
  trabajos: Trabajo[]
  omitidos: Omitido[]
  etiquetas: number
}

export const ROLLOS: Record<TipoEtiqueta, { titulo: string; detalle: string }> = {
  "codigos-29x20": { titulo: "Rollo chico 29x20", detalle: "Cargue el rollo chico 29x20 (3 por fila)." },
  "qr-6up": { titulo: "Rollo grande 100x150", detalle: "Cargue el rollo grande 100x150." },
  grande: { titulo: "Rollo grande 100x150", detalle: "Cargue el rollo grande 100x150." },
}

// ---------------------------------------------------------------------------
// Código de barras 29x20, tres por fila
// ---------------------------------------------------------------------------

const ANCHO_ETIQUETA = 29 * PUNTOS_POR_MM
const COLUMNAS_MM = [2, 34, 66] // inicio de cada etiqueta con SIZE 100 mm y GAP 2 mm
export const FILAS_POR_TANDA = 10
const ANCHO_CARACTER = 12 // fuente "2"

export const MENSAJE_CODIGO_ANCHO = "El código de barras de la referencia no entra en la etiqueta de 29 mm."

const CABECERA_29X20: OpcionesCabecera = { anchoMm: 100, altoMm: 20, gapMm: 2 }

interface EtiquetaCodigo {
  nombre: string
  referencia: string
  patron: string
}

function fila(etiquetas: EtiquetaCodigo[]): string {
  const L = [cabeceraTspl(CABECERA_29X20) + "CLS"]
  etiquetas.forEach(({ nombre, referencia, patron }, i) => {
    const n = textoImprimible(nombre).slice(0, MAX_CARACTERES_REFERENCIA)
    const r = textoImprimible(referencia)
    const base = COLUMNAS_MM[i] * PUNTOS_POR_MM
    const { ancho } = barras(patron, 0, 0, 0)
    L.push(`TEXT ${base + Math.floor((ANCHO_ETIQUETA - n.length * ANCHO_CARACTER) / 2)},20,"2",0,1,1,"${n}"`)
    L.push(...barras(patron, base + Math.floor((ANCHO_ETIQUETA - ancho) / 2), 46, 64).comandos)
    L.push(`TEXT ${base + Math.floor((ANCHO_ETIQUETA - r.length * ANCHO_CARACTER) / 2)},118,"2",0,1,1,"${r}"`)
  })
  L.push("PRINT 1,1")
  return L.join("\r\n") + "\r\n"
}

/**
 * Etiquetas 29x20 con Code128 de la referencia: 3 por fila, cada unidad de cantidad es una
 * etiqueta, tandas de a lo sumo 10 filas por trabajo. Los productos que no se pueden imprimir
 * se omiten (una vez por producto) con el motivo para mostrar en pantalla.
 */
export function trabajoCodigos(items: ItemEtiqueta[]): ResultadoTrabajos {
  const omitidos: Omitido[] = []
  const etiquetas: EtiquetaCodigo[] = []
  for (const item of items) {
    const omitir = (motivo: string) => omitidos.push({ alegraId: item.alegraId, nombre: item.nombre, motivo })
    const cant = validarCantidad(item.cantidad)
    if (!cant.ok) {
      omitir(cant.mensaje)
      continue
    }
    const ref = validarReferencia(item.referencia)
    if (!ref.ok) {
      omitir(ref.mensaje)
      continue
    }
    const referencia = item.referencia as string
    const patron = code128b(referencia)
    if (barras(patron, 0, 0, 0).ancho > ANCHO_ETIQUETA - 16) {
      omitir(MENSAJE_CODIGO_ANCHO)
      continue
    }
    for (let k = 0; k < item.cantidad; k++) etiquetas.push({ nombre: item.nombre, referencia, patron })
  }

  const filas: EtiquetaCodigo[][] = []
  for (let i = 0; i < etiquetas.length; i += COLUMNAS_MM.length) filas.push(etiquetas.slice(i, i + COLUMNAS_MM.length))
  const trabajos: Trabajo[] = []
  for (let k = 0; k < filas.length; k += FILAS_POR_TANDA) {
    const tanda = filas.slice(k, k + FILAS_POR_TANDA)
    trabajos.push({
      tipo: "codigos-29x20",
      datos: ascii(tanda.map(fila).join("")),
      etiquetas: tanda.reduce((n, f) => n + f.length, 0),
    })
  }
  return { trabajos, omitidos, etiquetas: etiquetas.length }
}

// ---------------------------------------------------------------------------
// QR 6 por hoja (100x150): layout puro + ensamble de bitmaps
// ---------------------------------------------------------------------------

export const QR6 = {
  anchoLienzo: 800,
  altoLienzo: 1200,
  celda: 400,
  columnas: 2,
  filas: 3,
  qr: 250,
  nombrePx: 25,
  webPx: 22,
  bordePx: 2,
} as const

export const CELDAS_POR_HOJA = QR6.columnas * QR6.filas

export const CABECERA_100X150: Required<OpcionesCabecera> = { anchoMm: 100, altoMm: 150, gapMm: 3, densidad: 10 }

export interface CeldaQr {
  x: number
  y: number
  ancho: number
  alto: number
  alegraId: string
  nombre: string
  url: string
  web: string
}

export interface HojaQr {
  /** Siempre CELDAS_POR_HOJA posiciones; null = celda vacía (sin borde). */
  celdas: (CeldaQr | null)[]
}

export type ResultadoLayoutQr =
  | { ok: true; hojas: HojaQr[]; omitidos: Omitido[]; etiquetas: number }
  | { ok: false; mensaje: string }

/** Distribuye una celda por unidad de cantidad en hojas de 2x3; la última se completa con vacías. */
export function layoutQr6(items: ItemEtiqueta[], shopUrl: string | null | undefined): ResultadoLayoutQr {
  const base = urlProductoQr(shopUrl, "")
  if (!base.ok) return base
  const web = hostWeb((shopUrl as string).trim())
  const omitidos: Omitido[] = []
  const unidades: Omit<CeldaQr, "x" | "y" | "ancho" | "alto">[] = []
  for (const item of items) {
    const cant = validarCantidad(item.cantidad)
    if (!cant.ok) {
      omitidos.push({ alegraId: item.alegraId, nombre: item.nombre, motivo: cant.mensaje })
      continue
    }
    const r = urlProductoQr(shopUrl, item.alegraId)
    if (!r.ok) return r
    for (let k = 0; k < item.cantidad; k++) unidades.push({ alegraId: item.alegraId, nombre: item.nombre, url: r.url, web })
  }
  const hojas: HojaQr[] = []
  for (let i = 0; i < unidades.length; i += CELDAS_POR_HOJA) {
    const celdas: (CeldaQr | null)[] = []
    for (let j = 0; j < CELDAS_POR_HOJA; j++) {
      const u = unidades[i + j]
      celdas.push(
        u
          ? { ...u, x: (j % QR6.columnas) * QR6.celda, y: Math.floor(j / QR6.columnas) * QR6.celda, ancho: QR6.celda, alto: QR6.celda }
          : null,
      )
    }
    hojas.push({ celdas })
  }
  return { ok: true, hojas, omitidos, etiquetas: unidades.length }
}

export interface Imagen1Bit {
  bytes: Uint8Array
  anchoBytes: number
  alto: number
}

/** Un trabajo con una cabecera y, por imagen, CLS + BITMAP a pantalla completa + PRINT 1,1. */
export function ensamblarTrabajoBitmap(opciones: OpcionesCabecera, imagenes: Imagen1Bit[]): Uint8Array {
  const partes: Uint8Array[] = [ascii(cabeceraTspl(opciones))]
  for (const img of imagenes) {
    partes.push(ascii("CLS\r\n"), comandoBitmap(0, 0, img.anchoBytes, img.alto, img.bytes), ascii("\r\nPRINT 1,1\r\n"))
  }
  return concatenar(partes)
}

/** Píxeles RGBA de una hoja dibujada (lo que devuelve `getImageData`). */
export interface PixelesRgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type ResultadoTrabajosQr = ({ ok: true } & ResultadoTrabajos) | { ok: false; mensaje: string }

/**
 * QR 6 por hoja (100x150, GAP 3 mm, DENSITY 10): un trabajo por hoja (un BITMAP + PRINT 1,1),
 * así ningún envío pasa de ~120 KB. `dibujar` rasteriza la hoja (canvas.ts en el navegador; un
 * doble en los tests): es la misma función que alimenta la vista previa.
 */
export async function trabajoQr6(
  items: ItemEtiqueta[],
  shopUrl: string | null | undefined,
  dibujar: (hoja: HojaQr) => Promise<PixelesRgba>,
): Promise<ResultadoTrabajosQr> {
  const layout = layoutQr6(items, shopUrl)
  if (!layout.ok) return layout
  const trabajos: Trabajo[] = []
  for (const hoja of layout.hojas) {
    const px = await dibujar(hoja)
    const { bytes, anchoBytes } = rgbaA1bit(px.data, px.width, px.height)
    trabajos.push({
      tipo: "qr-6up",
      datos: ensamblarTrabajoBitmap(CABECERA_100X150, [{ bytes, anchoBytes, alto: px.height }]),
      etiquetas: hoja.celdas.filter(Boolean).length,
    })
  }
  return { ok: true, trabajos, omitidos: layout.omitidos, etiquetas: layout.etiquetas }
}

// ---------------------------------------------------------------------------
// Vista previa del 29x20: la primera fila leída del MISMO TSPL que se envía
// ---------------------------------------------------------------------------

export interface FilaTspl {
  barras: { x: number; y: number; ancho: number; alto: number }[]
  textos: { x: number; y: number; texto: string }[]
}

/** BAR y TEXT del primer bloque CLS…PRINT de un trabajo de texto TSPL. */
export function primeraFilaTspl(tspl: string): FilaTspl {
  const fila: FilaTspl = { barras: [], textos: [] }
  for (const linea of tspl.split("\r\n")) {
    if (linea.startsWith("PRINT")) break
    const bar = /^BAR (\d+),(\d+),(\d+),(\d+)$/.exec(linea)
    if (bar) {
      const [x, y, ancho, alto] = bar.slice(1).map(Number)
      fila.barras.push({ x, y, ancho, alto })
      continue
    }
    const txt = /^TEXT (\d+),(\d+),"[^"]*",\d+,\d+,\d+,"(.*)"$/.exec(linea)
    if (txt) fila.textos.push({ x: Number(txt[1]), y: Number(txt[2]), texto: txt[3] })
  }
  return fila
}
