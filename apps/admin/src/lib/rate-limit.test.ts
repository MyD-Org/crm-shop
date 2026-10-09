import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ipDe, permitir } from "./rate-limit"

// Las claves llevan un prefijo distinto por test porque el store vive en el módulo.

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("permitir", () => {
  it("deja pasar hasta el máximo y corta después", () => {
    const clave = "tope:x"
    expect(permitir(clave, 3, 60_000)).toBe(true)
    expect(permitir(clave, 3, 60_000)).toBe(true)
    expect(permitir(clave, 3, 60_000)).toBe(true)
    expect(permitir(clave, 3, 60_000)).toBe(false)
  })

  it("no consume usos cuando ya cortó y reabre al vencer la ventana", () => {
    const clave = "ventana:x"
    permitir(clave, 1, 60_000)
    permitir(clave, 1, 60_000)
    vi.advanceTimersByTime(59_000)
    expect(permitir(clave, 1, 60_000)).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(permitir(clave, 1, 60_000)).toBe(true)
  })

  it("cuenta cada clave por separado y un máximo de 0 no deja pasar a nadie", () => {
    expect(permitir("aislado:a", 1, 60_000)).toBe(true)
    expect(permitir("aislado:a", 1, 60_000)).toBe(false)
    expect(permitir("aislado:b", 1, 60_000)).toBe(true)
    expect(permitir("cero:a", 0, 60_000)).toBe(false)
  })
})

describe("ipDe", () => {
  it("toma la primera IP de x-forwarded-for, después x-real-ip y por último una clave compartida", () => {
    const con = (h: Record<string, string>) => new Request("http://crm.example/x", { headers: h })
    expect(ipDe(con({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" }))).toBe("203.0.113.1")
    expect(ipDe(con({ "x-real-ip": "203.0.113.2" }))).toBe("203.0.113.2")
    expect(ipDe(con({}))).toBe("desconocida")
  })
})
