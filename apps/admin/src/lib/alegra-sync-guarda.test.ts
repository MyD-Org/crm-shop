import { describe, expect, it } from "vitest"
import { evaluarCorrida } from "./alegra-sync-guarda"

// Guarda de la sync del CRM (D7): una corrida sensiblemente más corta que la última OK del tenant
// no da de baja nada. Productos y categorías se evalúan por separado.

const base = (items: number, categorias = 3) => ({ items, categorias })

describe("evaluarCorrida", () => {
  it("0 ítems sin base → parcial", () => {
    const r = evaluarCorrida({ items: 0, categorias: 0 }, null)
    expect(r.parcialItems).toBe(true)
    expect(r.parcial).toBe(true)
  })

  it("0 ítems con base → parcial", () => {
    expect(evaluarCorrida({ items: 0, categorias: 3 }, base(1000)).parcialItems).toBe(true)
  })

  it("primera corrida con ítems → ok", () => {
    expect(evaluarCorrida({ items: 500, categorias: 2 }, null)).toEqual({
      parcial: false,
      parcialItems: false,
      parcialCategorias: false,
      motivo: null,
    })
  })

  it("base 11 795 y −4 % → ok", () => {
    expect(evaluarCorrida({ items: 11323, categorias: 3 }, base(11795)).parcial).toBe(false)
  })

  it("base 11 795 y −6 % → parcial, con motivo sólo numérico", () => {
    const r = evaluarCorrida({ items: 11087, categorias: 3 }, base(11795))
    expect(r.parcialItems).toBe(true)
    expect(r.parcialCategorias).toBe(false)
    expect(r.motivo).toBe("items 11087 < base 11795 (umbral 95 %)")
  })

  it("base 100 y −8 → ok (tolerancia de 10)", () => {
    expect(evaluarCorrida({ items: 92, categorias: 3 }, base(100)).parcial).toBe(false)
  })

  it("base 100 y −11 → parcial", () => {
    expect(evaluarCorrida({ items: 89, categorias: 3 }, base(100)).parcialItems).toBe(true)
  })

  it("más ítems que la base → ok", () => {
    expect(evaluarCorrida({ items: 1200, categorias: 5 }, base(1000)).parcial).toBe(false)
  })

  it("categorías 3 → 2 → ok", () => {
    expect(evaluarCorrida({ items: 1000, categorias: 2 }, base(1000, 3)).parcialCategorias).toBe(false)
  })

  it("categorías 3 → 0 con ítems normales → sólo parcial de categorías", () => {
    const r = evaluarCorrida({ items: 1000, categorias: 0 }, base(1000, 3))
    expect(r.parcialCategorias).toBe(true)
    expect(r.parcialItems).toBe(false)
    expect(r.parcial).toBe(true)
    expect(r.motivo).toBe("categorias 0 < base 3 (umbral 95 %)")
  })

  it("categorías 0 sin base de categorías y 1000 ítems → ok", () => {
    expect(evaluarCorrida({ items: 1000, categorias: 0 }, base(1000, 0)).parcial).toBe(false)
    expect(evaluarCorrida({ items: 1000, categorias: 0 }, null).parcial).toBe(false)
  })

  it("las dos anomalías juntas → motivo con las dos", () => {
    expect(evaluarCorrida({ items: 0, categorias: 0 }, base(1000, 3)).motivo).toBe(
      "items 0 < base 1000 (umbral 95 %); categorias 0 < base 3 (umbral 95 %)",
    )
  })

  it("0 ítems sin base → motivo sin base", () => {
    expect(evaluarCorrida({ items: 0, categorias: 0 }, null).motivo).toBe("items 0 (sin corrida ok previa)")
  })

  it("aceptarBaja → nunca parcial", () => {
    expect(evaluarCorrida({ items: 0, categorias: 0 }, base(1000, 3), { aceptarBaja: true })).toEqual({
      parcial: false,
      parcialItems: false,
      parcialCategorias: false,
      motivo: null,
    })
  })
})
