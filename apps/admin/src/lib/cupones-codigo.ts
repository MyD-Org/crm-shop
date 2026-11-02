// Códigos de cupón (spec 2026-11-01-cupones-design.md). Los únicos son `<PREFIJO>-` + 5 caracteres
// de un alfabeto sin ambiguos (sin 0/O, 1/I/L): ~28 millones de combinaciones por prefijo. El
// choque se resuelve reintentando contra el índice único (cupones-repo.ts).
import { randomInt } from "node:crypto"

export const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const LARGO_SUFIJO = 5

/** `azar` devuelve [0, 1); por defecto, `crypto.randomInt` (los códigos no deben ser adivinables). */
export function generarCodigo(prefijo: string, azar?: () => number): string {
  let sufijo = ""
  for (let i = 0; i < LARGO_SUFIJO; i++) {
    const n = azar ? Math.floor(azar() * ALFABETO_CODIGO.length) : randomInt(ALFABETO_CODIGO.length)
    sufijo += ALFABETO_CODIGO[n]
  }
  return `${prefijo}-${sufijo}`
}

/** Mayúsculas y sólo [A-Z0-9]: la misma expresión que la columna generada `codigo_norm`. */
export function normalizarCodigo(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
}
