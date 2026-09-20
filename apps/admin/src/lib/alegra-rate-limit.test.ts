import { describe, expect, it } from "vitest"
import { esperaDeReintento } from "./alegra"

// Alegra limita por minuto y devuelve 429 sin avisar. Esta es la decisión que hacía fallar la
// sync del catálogo grande todos los días, así que conviene tenerla clavada con tests.

const SIN_JITTER = () => 0
const JITTER_MAX = () => 1

describe("esperaDeReintento", () => {
  it("crece exponencialmente cuando Alegra no sugiere nada", () => {
    const esperas = [0, 1, 2, 3, 4].map((i) => esperaDeReintento(i, null, SIN_JITTER))
    expect(esperas).toEqual([1000, 2000, 4000, 8000, 16000])
  })

  it("respeta Retry-After por encima del backoff", () => {
    expect(esperaDeReintento(0, "7", SIN_JITTER)).toBe(7000)
  })

  it("acota un Retry-After exagerado para que no se coma la corrida", () => {
    expect(esperaDeReintento(0, "600", SIN_JITTER)).toBe(30_000)
  })

  it("acota también el backoff: no espera más que el techo", () => {
    expect(esperaDeReintento(20, null, SIN_JITTER)).toBe(30_000)
  })

  it("ignora un Retry-After que no sea un número positivo", () => {
    for (const raro of ["", "ya", "-3", "0", "NaN"]) {
      expect(esperaDeReintento(1, raro, SIN_JITTER), `retry-after=${raro}`).toBe(2000)
    }
  })

  it("suma jitter, y nunca espera MENOS que la base", () => {
    // Sin jitter las N requests de una tanda paralela reciben el 429 a la vez, esperan lo mismo y
    // vuelven a chocar todas juntas contra la misma ventana. Por eso se desparraman.
    const base = esperaDeReintento(2, null, SIN_JITTER)
    const conJitter = esperaDeReintento(2, null, JITTER_MAX)
    expect(base).toBe(4000)
    expect(conJitter).toBe(6000)
    for (const r of [0, 0.1, 0.5, 0.9, 1]) {
      const espera = esperaDeReintento(2, null, () => r)
      expect(espera).toBeGreaterThanOrEqual(base)
      expect(espera).toBeLessThanOrEqual(base * 1.5)
    }
  })

  it("dos requests de la misma tanda no esperan lo mismo", () => {
    const a = esperaDeReintento(1, null, () => 0.1)
    const b = esperaDeReintento(1, null, () => 0.9)
    expect(a).not.toBe(b)
  })
})
