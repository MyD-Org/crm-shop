import { describe, it, expect } from "vitest"
import { MARCAS_TARJETA, esMarcaValida, nombreDeMarca, ordenarMarcas } from "@/lib/marcas-tarjeta"

describe("marcas de tarjeta", () => {
  it("ofrece las 7 marcas con ids canónicos en minúscula", () => {
    expect(MARCAS_TARJETA.map((m) => m.id)).toEqual(["visa", "mastercard", "amex", "naranja", "cabal", "argencard", "diners"])
    for (const m of MARCAS_TARJETA) expect(m.id).toMatch(/^[a-z0-9]+$/)
  })

  it("esMarcaValida sólo acepta ids de la lista", () => {
    expect(esMarcaValida("visa")).toBe(true)
    expect(esMarcaValida("Visa")).toBe(false)
    expect(esMarcaValida("maestro")).toBe(false)
    expect(esMarcaValida(1)).toBe(false)
  })

  it("nombreDeMarca da el nombre visible y cae al id si no lo conoce", () => {
    expect(nombreDeMarca("mastercard")).toBe("Mastercard")
    expect(nombreDeMarca("amex")).toBe("American Express")
    expect(nombreDeMarca("otra")).toBe("otra")
  })

  it("ordenarMarcas usa el orden de la lista", () => {
    expect(ordenarMarcas(["diners", "visa", "cabal"])).toEqual(["visa", "cabal", "diners"])
  })
})
