import { describe, it, expect } from "vitest"
import { ALFABETO_CODIGO, generarCodigo, normalizarCodigo } from "./cupones-codigo"

describe("cupones-codigo", () => {
  it("el alfabeto no tiene caracteres ambiguos", () => {
    expect(ALFABETO_CODIGO).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    for (const c of "0O1IL") expect(ALFABETO_CODIGO).not.toContain(c)
  })

  it("generarCodigo: prefijo, guion y 5 caracteres del alfabeto", () => {
    expect(generarCodigo("LUZ", () => 0)).toBe("LUZ-AAAAA")
    expect(generarCodigo("LUZ", () => 0.9999)).toBe("LUZ-99999")
    for (let i = 0; i < 50; i++) expect(generarCodigo("LUZ")).toMatch(/^LUZ-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
  })

  it("normalizarCodigo: mayúsculas y sólo letras y números", () => {
    expect(normalizarCodigo(" luz–7kq2m ")).toBe("LUZ7KQ2M")
    expect(normalizarCodigo("LUZ 7KQ2M")).toBe("LUZ7KQ2M")
    expect(normalizarCodigo("apertura-10")).toBe("APERTURA10")
  })
})
