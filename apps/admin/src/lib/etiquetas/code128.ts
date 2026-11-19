/**
 * Code 128 subconjunto B para la impresora térmica TSPL (203 dpi = 8 puntos/mm).
 * Port de `scripts/etiquetas/tspl.ts` (mismo resultado byte a byte), sin dependencias de Node.
 */

export const PUNTOS_POR_MM = 8
/** Fuente "2" (12x20 puntos) en una etiqueta de 29 mm. */
export const MAX_CARACTERES_REFERENCIA = 18

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
const INICIO_B = 104

export const MENSAJES_REFERENCIA = {
  vacia: "El producto no tiene referencia.",
  caracteres: "La referencia contiene caracteres que no se pueden imprimir en código de barras.",
  larga: `La referencia admite hasta ${MAX_CARACTERES_REFERENCIA} caracteres para el código de barras.`,
} as const

export type Validacion = { ok: true } | { ok: false; mensaje: string }

/** Valida que la referencia se pueda codificar en Code128B dentro de una etiqueta de 29 mm. */
export function validarReferencia(code: string | null | undefined): Validacion {
  if (code == null || code.trim() === "") return { ok: false, mensaje: MENSAJES_REFERENCIA.vacia }
  for (const c of code) {
    const v = c.charCodeAt(0)
    if (c.length !== 1 || v < 32 || v > 126) return { ok: false, mensaje: MENSAJES_REFERENCIA.caracteres }
  }
  if (code.length > MAX_CARACTERES_REFERENCIA) return { ok: false, mensaje: MENSAJES_REFERENCIA.larga }
  return { ok: true }
}

/**
 * Code128 subconjunto B: devuelve la secuencia de anchos (barra, espacio, barra…) en módulos.
 * Lanza un Error con el mensaje de `validarReferencia` si la referencia no es válida; quien
 * arma trabajos valida antes para no propagar la excepción a la UI.
 */
export function code128b(texto: string): string {
  const v = validarReferencia(texto)
  if (!v.ok) throw new Error(v.mensaje)
  return patronCode128b(texto)
}

/**
 * Code128B sin el tope de caracteres de la etiqueta de 29 mm (para etiquetas más anchas, como la
 * de precio 4 por hoja). null si está vacío o tiene caracteres fuera de ASCII imprimible.
 */
export function code128bLargo(texto: string): string | null {
  if (!/^[\x20-\x7e]+$/.test(texto) || texto.trim() === "") return null
  return patronCode128b(texto)
}

function patronCode128b(texto: string): string {
  const valores = [INICIO_B, ...[...texto].map((c) => c.charCodeAt(0) - 32)]
  const chk = checksumCode128(valores)
  return [...valores, chk].map((x) => PATRONES[x]).join("") + STOP
}

/** Checksum módulo 103: el inicio pesa 1 y cada símbolo pesa su posición. */
export function checksumCode128(valores: number[]): number {
  return valores.reduce((acc, v, i) => acc + (i === 0 ? v : i * v), 0) % 103
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
