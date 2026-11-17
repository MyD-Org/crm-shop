import { describe, expect, it } from "vitest"
import { textoImprimible, validarCantidad } from "./texto"

describe("textoImprimible", () => {
  it("quita tildes, diéresis y ñ y deja sólo ASCII imprimible", () => {
    const r = textoImprimible("Lámpara Ñandú Ø pingüino")
    expect(r).toBe("Lampara Nandu pinguino")
    expect(/^[\x20-\x7e]*$/.test(r)).toBe(true)
  })

  it("elimina comillas dobles y caracteres de control", () => {
    expect(textoImprimible('Tubo "T8"\u0007 18W')).toBe("Tubo T8 18W")
  })

  it("colapsa espacios", () => {
    expect(textoImprimible("  Tubo \t  T8\n18W  ")).toBe("Tubo T8 18W")
  })
})

describe("validarCantidad", () => {
  const error = { ok: false, mensaje: "Ingrese una cantidad entera entre 1 y 999." }
  it.each([0, -1, 1.5, "abc", "", 1000, NaN, null])("rechaza %s", (n) => {
    expect(validarCantidad(n)).toEqual(error)
  })
  it.each([1, 999, "12"])("acepta %s", (n) => {
    expect(validarCantidad(n)).toEqual({ ok: true })
  })
})
