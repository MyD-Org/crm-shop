/**
 * Conversión de píxeles RGBA a BITMAP de 1 bit para TSPL y armado de bytes. Puro (sin DOM):
 * recibe el `data` de un ImageData o un arreglo sintético.
 */

const codificador = new TextEncoder()

/** Bytes ASCII de un texto de comandos TSPL. */
export function ascii(s: string): Uint8Array {
  return codificador.encode(s)
}

/** Concatena trozos de bytes en un único Uint8Array. */
export function concatenar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0)
  const salida = new Uint8Array(total)
  let i = 0
  for (const p of partes) {
    salida.set(p, i)
    i += p.length
  }
  return salida
}

/**
 * RGBA -> 1 bit por píxel. En TSPL el bit 1 es blanco y el 0 imprime: se imprime el píxel con
 * luminancia < 128 tras componer el alfa contra blanco. Cada fila se rellena al byte con bits
 * en 1 (blanco).
 */
export function rgbaA1bit(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): { bytes: Uint8Array; anchoBytes: number } {
  if (rgba.length < w * h * 4) throw new Error(`Faltan píxeles: se esperaban ${w * h * 4} valores y hay ${rgba.length}.`)
  const anchoBytes = Math.ceil(w / 8)
  const bytes = new Uint8Array(anchoBytes * h).fill(0xff)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // Aritmética entera (pesos BT.601 x1000 y alfa x255) para que el umbral sea exacto.
      const a = rgba[i + 3]
      const lum = 299 * rgba[i] + 587 * rgba[i + 1] + 114 * rgba[i + 2]
      const compuesto = lum * a + 255 * 1000 * (255 - a)
      if (compuesto < 128 * 1000 * 255) bytes[y * anchoBytes + (x >> 3)] &= ~(0x80 >> (x & 7))
    }
  }
  return { bytes, anchoBytes }
}

export interface OpcionesCabecera {
  anchoMm: number
  altoMm: number
  gapMm: number
  densidad?: number
}

/** Cabecera TSPL (sin CLS), cada comando terminado en CRLF. */
export function cabeceraTspl({ anchoMm, altoMm, gapMm, densidad }: OpcionesCabecera): string {
  const lineas = [`SIZE ${anchoMm} mm,${altoMm} mm`, `GAP ${gapMm} mm,0 mm`, "DIRECTION 0", "REFERENCE 0,0"]
  if (densidad !== undefined) lineas.push(`DENSITY ${densidad}`)
  return lineas.join("\r\n") + "\r\n"
}

/** `BITMAP x,y,anchoBytes,alto,0,` seguido de los bytes crudos, sin saltos de línea intermedios. */
export function comandoBitmap(x: number, y: number, anchoBytes: number, alto: number, bytes: Uint8Array): Uint8Array {
  if (bytes.length !== anchoBytes * alto) {
    throw new Error(`El bitmap debe tener ${anchoBytes * alto} bytes y tiene ${bytes.length}.`)
  }
  return concatenar([ascii(`BITMAP ${x},${y},${anchoBytes},${alto},0,`), bytes])
}
