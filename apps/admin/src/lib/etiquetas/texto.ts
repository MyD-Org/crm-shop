import type { Validacion } from "./code128"

export const CANTIDAD_MIN = 1
export const CANTIDAD_MAX = 999
export const MENSAJE_CANTIDAD = `Ingrese una cantidad entera entre ${CANTIDAD_MIN} y ${CANTIDAD_MAX}.`

/**
 * Texto seguro dentro de un comando TEXT de TSPL: las fuentes internas no traen tildes ni ñ,
 * y una comilla doble cortaría el comando. Sólo para comandos TEXT; lo que se dibuja en
 * bitmaps (canvas) conserva el texto original.
 */
export function textoImprimible(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/"/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
}

/** Cantidad de etiquetas por producto: entero entre 1 y 999. Acepta lo que venga de un input. */
export function validarCantidad(n: unknown): Validacion {
  const valor = typeof n === "string" ? (n.trim() === "" ? NaN : Number(n)) : n
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < CANTIDAD_MIN || valor > CANTIDAD_MAX) {
    return { ok: false, mensaje: MENSAJE_CANTIDAD }
  }
  return { ok: true }
}
