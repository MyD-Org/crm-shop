/**
 * Utilidades compartidas de las etiquetas para la impresora térmica TSPL (203 dpi = 8 puntos/mm).
 * Ver README.md de esta carpeta.
 */
import { createRequire } from "node:module"
import { resolve } from "node:path"

export const PUNTOS_POR_MM = 8

// Patrones Code128 (ancho de barra/espacio por módulo) para los valores 0..106.
const PATRONES = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 " +
  "122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 " +
  "321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 " +
  "211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 " +
  "213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 " +
  "121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 " +
  "241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 " +
  "412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 " +
  "211214 211232"
).split(" ")
const STOP = "2331112"

/** Code128 subconjunto B: devuelve la secuencia de anchos (barra, espacio, barra…) en módulos. */
export function code128b(texto: string): string {
  const valores = [104, ...[...texto].map((c) => {
    const v = c.charCodeAt(0) - 32
    if (v < 0 || v > 94) throw new Error(`Carácter fuera de Code128B: ${JSON.stringify(c)}`)
    return v
  })]
  const chk = valores.reduce((acc, v, i) => acc + (i === 0 ? v : i * v), 0) % 103
  return [...valores, chk].map((v) => PATRONES[v]).join("") + STOP
}

/**
 * Dibuja el código con comandos BAR de 1 punto por módulo. El comando BARCODE "128" de esta
 * impresora sale el doble de ancho con narrow=1 y se corta en etiquetas chicas.
 */
export function barras(patron: string, x: number, y: number, alto: number): { comandos: string[]; ancho: number } {
  const comandos: string[] = []
  let cx = x
  ;[...patron].forEach((d, i) => {
    const w = Number(d)
    if (i % 2 === 0) comandos.push(`BAR ${cx},${y},${w},${alto}`)
    cx += w
  })
  return { comandos, ancho: cx - x }
}

/**
 * Convierte un PNG (del tamaño exacto de la etiqueta, en puntos) a un trabajo TSPL con un BITMAP
 * de 1 bit. En TSPL el bit 1 es blanco y el 0 imprime.
 */
export async function pngATspl(
  png: string,
  opciones: { altoMm: number; anchoMm: number; gapMm?: number; densidad?: number; copias?: number },
): Promise<Buffer> {
  const { default: sharp } = await import("sharp")
  const { data, info } = await sharp(png).flatten({ background: "#fff" }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const wb = Math.ceil(W / 8)
  const bits = Buffer.alloc(wb * H, 0xff)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (data[y * W + x] < 128) bits[y * wb + (x >> 3)] &= ~(0x80 >> (x & 7))
  const cabecera = [
    `SIZE ${opciones.anchoMm} mm,${opciones.altoMm} mm`,
    `GAP ${opciones.gapMm ?? 3} mm,0 mm`,
    "DIRECTION 0",
    "REFERENCE 0,0",
    `DENSITY ${opciones.densidad ?? 10}`,
    "CLS",
    `BITMAP 0,0,${wb},${H},0,`,
  ].join("\r\n")
  return Buffer.concat([Buffer.from(cabecera), bits, Buffer.from(`\r\nPRINT 1,${opciones.copias ?? 1}\r\n`)])
}

/**
 * Carga un paquete que NO es dependencia del CRM (usb, qrcode) desde la carpeta de
 * ETIQUETAS_DEPS, para no sumar módulos nativos al build de Vercel.
 */
export function requerirExterno<T>(paquete: string): T {
  const dir = process.env.ETIQUETAS_DEPS
  if (!dir) {
    throw new Error(
      `Falta ETIQUETAS_DEPS. Instale una vez: npm i --prefix ~/.etiquetas-deps usb@2.14.0 qrcode@1.5.4 ` +
        `y exporte ETIQUETAS_DEPS=~/.etiquetas-deps`,
    )
  }
  return createRequire(resolve(dir) + "/")(paquete) as T
}
