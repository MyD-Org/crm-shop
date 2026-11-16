import { describe, expect, it } from "vitest"
import {
  masFrecuente,
  sufijoDeCodigo,
  sufijoNuevoDeMarca,
  sugerirCodigo,
  sugerirMarca,
  sugerirNombre,
  sugerirPorMarca,
  type FilaCatalogo,
} from "./compras-producto-sugerencias"

const f = (code: string | null, brand: string | null, iva: number | null = 21, cat: string | null = null): FilaCatalogo => ({
  code,
  name: `Producto ${code}`,
  brand,
  ivaPorcentaje: iva,
  categoryAlegraId: cat,
})

const CATALOGO = [
  f("02141N-JDV", "Jadever", 21, "12"),
  f("LED9-JDV", "Jadever", 21, "12"),
  f("CBL1-JDV", "Jadever", 10.5, "15"),
  f("X1-MCL", "Macroled", 21, "20"),
  f("SINSUF", "Otra", 21, null),
]

describe("sufijos", () => {
  it("toma lo que sigue al último guion", () => {
    expect(sufijoDeCodigo("02141N-JDV")).toBe("JDV")
    expect(sufijoDeCodigo("A-B-chint")).toBe("CHINT")
    expect(sufijoDeCodigo("SINSUF")).toBeNull()
    expect(sufijoDeCodigo("ABC-")).toBeNull()
    expect(sufijoDeCodigo(null)).toBeNull()
  })

  it("propone uno nuevo con consonantes iniciales", () => {
    expect(sufijoNuevoDeMarca("Jadever")).toBe("JDV")
    expect(sufijoNuevoDeMarca("Ge")).toBe("GE")
    expect(sufijoNuevoDeMarca("Áurea")).toBe("AUR")
  })
})

describe("sugerirPorMarca", () => {
  it("marca conocida: sufijo, categoría e IVA más frecuentes (sin tildes ni mayúsculas)", () => {
    expect(sugerirPorMarca(CATALOGO, "JADEVER")).toEqual({ sufijo: "JDV", sufijoEsNuevo: false, categoriaId: "12", ivaPorcentaje: 21 })
  })

  it("marca nueva: sufijo sugerido marcado como nuevo y sin categoría", () => {
    expect(sugerirPorMarca(CATALOGO, "Nuevamarca")).toEqual({ sufijo: "NVM", sufijoEsNuevo: true, categoriaId: null, ivaPorcentaje: null })
  })

  it("marca existente pero sin sufijos en sus códigos: sufijo nuevo", () => {
    expect(sugerirPorMarca(CATALOGO, "Otra")).toMatchObject({ sufijoEsNuevo: true })
  })

  it("marca vacía: nada", () => {
    expect(sugerirPorMarca(CATALOGO, " ")).toEqual({ sufijo: null, sufijoEsNuevo: false, categoriaId: null, ivaPorcentaje: null })
  })
})

describe("sugerirMarca", () => {
  it("usa la más frecuente de las compras previas", () => {
    expect(sugerirMarca(["Jadever", "Macroled", "Jadever", null], ["Chint"], "x")).toBe("Jadever")
  })

  it("sin compras, coincide por nombre (la más larga primero)", () => {
    expect(sugerirMarca([], ["Led", "Macroled"], "Proveedor Macroled SA")).toBe("Macroled")
    expect(sugerirMarca([], ["Chint"], "Proveedor sin marca")).toBeNull()
  })
})

describe("nombre y código", () => {
  it("limpia espacios y avisa si sólo escribió un código", () => {
    expect(sugerirNombre("  Lámpara   LED 9W ")).toEqual({ nombre: "Lámpara LED 9W", soloCodigo: false })
    expect(sugerirNombre("02141N")).toEqual({ nombre: "02141N", soloCodigo: true })
    expect(sugerirNombre("")).toEqual({ nombre: "", soloCodigo: false })
  })

  it("el código es el texto si es una sola palabra, o la primera palabra con dígitos", () => {
    expect(sugerirCodigo("02141N")).toBe("02141N")
    expect(sugerirCodigo("Lámpara LED9W azul")).toBe("LED9W")
    expect(sugerirCodigo("Lámpara azul")).toBeNull()
  })
})

describe("masFrecuente", () => {
  it("ignora vacíos y desempata por orden de aparición", () => {
    expect(masFrecuente(["a", null, "", "b", "b", "a"])).toBe("a")
    expect(masFrecuente([])).toBeNull()
  })
})
