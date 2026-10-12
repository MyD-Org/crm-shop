import { describe, expect, it } from "vitest"
import { claveVariante, etiquetaDe, padreDeItem, tipoDeItem, varianteDeItem } from "./variantes-puras"

// Fixtures sintéticos: la forma sale del spike contra Alegra (2026-10-11), sin datos reales.
const atributoColor = (valor: string) => [
  { id: 1, name: "Color", status: "active", options: [{ id: 10, value: valor }] },
]

describe("tipoDeItem", () => {
  it("variantParent es padre, variant es variante", () => {
    expect(tipoDeItem({ type: "variantParent" })).toBe("padre")
    expect(tipoDeItem({ type: "variant" })).toBe("variante")
  })
  it("simple, kit, product y sin type son simples", () => {
    expect(tipoDeItem({ type: "product" })).toBe("simple")
    expect(tipoDeItem({ type: "simple" })).toBe("simple")
    expect(tipoDeItem({ type: "kit" })).toBe("simple")
    expect(tipoDeItem({})).toBe("simple")
    expect(tipoDeItem({ type: null })).toBe("simple")
  })
})

describe("padreDeItem", () => {
  it("devuelve idItemParent como texto en una variante", () => {
    expect(padreDeItem({ type: "variant", idItemParent: 77 })).toBe("77")
    expect(padreDeItem({ type: "variant", idItemParent: "78" })).toBe("78")
    expect(padreDeItem({ type: "variant", idItemParent: { id: 79 } })).toBe("79")
  })
  it("null en padres y simples, aunque traigan idItemParent", () => {
    expect(padreDeItem({ type: "variantParent", idItemParent: 1 })).toBeNull()
    expect(padreDeItem({ type: "product", idItemParent: 1 })).toBeNull()
    expect(padreDeItem({ type: "variant" })).toBeNull()
    expect(padreDeItem({ type: "variant", idItemParent: "" })).toBeNull()
  })
})

describe("varianteDeItem", () => {
  it("toma la opción de variantAttributes", () => {
    const raw = { type: "variant", name: "Cinta LED / Verde", variantAttributes: atributoColor("Verde") }
    expect(varianteDeItem(raw)).toEqual([{ atributo: "Color", opcion: "Verde" }])
  })
  it("varios atributos: una opción por atributo, en el orden de Alegra", () => {
    const raw = {
      type: "variant",
      variantAttributes: [
        { name: "Color", options: [{ value: "Blanco" }] },
        { name: "Potencia", options: [{ value: "18W" }] },
      ],
    }
    expect(varianteDeItem(raw)).toEqual([
      { atributo: "Color", opcion: "Blanco" },
      { atributo: "Potencia", opcion: "18W" },
    ])
  })
  it("deriva la opción del sufijo del nombre cuando variantAttributes es null", () => {
    const raw = { type: "variant", name: "Panel 18W / Blanco frío", variantAttributes: null }
    expect(varianteDeItem(raw)).toEqual([{ atributo: "Opción", opcion: "Blanco frío" }])
  })
  it("sin variantAttributes toma lo que sigue al último ' / '", () => {
    expect(varianteDeItem({ type: "variant", name: "A / B / Rojo" })).toEqual([{ atributo: "Opción", opcion: "Rojo" }])
  })
  it("con el nombre del padre, la opción es lo que sigue a 'Padre / '", () => {
    expect(varianteDeItem({ type: "variant", name: "Cinta / LED / Verde / 5m" }, "Cinta / LED")).toEqual([
      { atributo: "Opción", opcion: "Verde / 5m" },
    ])
  })
  it("variantAttributes vacío cae al nombre", () => {
    expect(varianteDeItem({ type: "variant", name: "X / Azul", variantAttributes: [] })).toEqual([
      { atributo: "Opción", opcion: "Azul" },
    ])
  })
  it("sin opción resoluble devuelve null", () => {
    expect(varianteDeItem({ type: "variant", name: "Sin separador" })).toBeNull()
    expect(varianteDeItem({ type: "variant", name: "Termina / " })).toBeNull()
  })
  it("solo las variantes tienen opción", () => {
    expect(varianteDeItem({ type: "variantParent", name: "Modelo / Algo", variantAttributes: atributoColor("Rojo") })).toBeNull()
    expect(varianteDeItem({ type: "product", name: "Cable 2 / 5m" })).toBeNull()
  })
})

describe("claveVariante", () => {
  it("normaliza tildes, espacios y mayúsculas", () => {
    expect(claveVariante([{ atributo: "Color", opcion: "  Blanco   Cálido " }])).toBe("blanco calido")
    expect(claveVariante([{ atributo: "Color", opcion: "blanco calido" }])).toBe("blanco calido")
  })
  it("no incluye el nombre del atributo", () => {
    expect(claveVariante([{ atributo: "Color", opcion: "Verde" }])).toBe(claveVariante([{ atributo: "Tono", opcion: "verde" }]))
  })
  it("ordena y une con '|'", () => {
    const a = claveVariante([
      { atributo: "Potencia", opcion: "18W" },
      { atributo: "Color", opcion: "Blanco" },
    ])
    expect(a).toBe("18w|blanco")
    expect(
      claveVariante([
        { atributo: "Color", opcion: "Blanco" },
        { atributo: "Potencia", opcion: "18W" },
      ]),
    ).toBe(a)
  })
  it("null cuando no hay opciones", () => {
    expect(claveVariante(null)).toBeNull()
    expect(claveVariante([])).toBeNull()
    expect(claveVariante([{ atributo: "Color", opcion: "  " }])).toBeNull()
  })
})

describe("etiquetaDe", () => {
  it("une las opciones con ' / '", () => {
    expect(
      etiquetaDe([
        { atributo: "Color", opcion: "Blanco" },
        { atributo: "Potencia", opcion: "18W" },
      ]),
    ).toBe("Blanco / 18W")
  })
  it("la etiqueta manual gana", () => {
    expect(etiquetaDe([{ atributo: "Color", opcion: "Verde" }], "RGB")).toBe("RGB")
    expect(etiquetaDe(null, "RGB")).toBe("RGB")
  })
  it("manual vacía no cuenta", () => {
    expect(etiquetaDe([{ atributo: "Color", opcion: "Verde" }], "  ")).toBe("Verde")
  })
  it("null sin nada", () => {
    expect(etiquetaDe(null)).toBeNull()
  })
})
