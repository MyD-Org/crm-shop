import { describe, expect, it } from "vitest"
import { ajustesNuevos, fechaDesde, parsearAjustes } from "./alegra-ajustes-inventario"

// Unit de la lectura de ajustes de inventario (sin base ni Alegra).

const crudo = [
  { id: 10, date: "2026-11-17", items: [{ id: 3600, quantity: 3, type: "in" }, { id: 3601, quantity: 1, type: "in" }] },
  { id: 9, date: "2026-11-05", items: [{ id: 50, quantity: 2, type: "out" }] },
  { id: 8, date: "2026-11-17", items: [] },
  { date: "2026-11-17", items: [{ id: 1 }] },
]

describe("parsearAjustes", () => {
  it("acepta array o { data } y descarta los que no tienen id o fecha", () => {
    expect(parsearAjustes(crudo).map((a) => a.id)).toEqual(["10", "9", "8"])
    expect(parsearAjustes({ data: crudo }).map((a) => a.id)).toEqual(["10", "9", "8"])
    expect(parsearAjustes(null)).toEqual([])
  })

  it("ids de ítems como texto y una huella que cambia con las cantidades", () => {
    const [a] = parsearAjustes(crudo)
    expect(a.itemIds).toEqual(["3600", "3601"])
    const [editado] = parsearAjustes([{ ...crudo[0], items: [{ id: 3600, quantity: 4, type: "in" }, { id: 3601, quantity: 1, type: "in" }] }])
    expect(editado.huella).not.toBe(a.huella)
    const [reordenado] = parsearAjustes([{ ...crudo[0], items: [...crudo[0].items].reverse() }])
    expect(reordenado.huella).toBe(a.huella)
  })
})

describe("fechaDesde", () => {
  it("dos días atrás en hora de Argentina", () => {
    // 01:30 UTC del 18 = 22:30 del 17 en Argentina → desde el 15.
    expect(fechaDesde(new Date("2026-11-18T01:30:00Z"))).toBe("2026-11-15")
    expect(fechaDesde(new Date("2026-11-18T12:00:00Z"))).toBe("2026-11-16")
  })
})

describe("ajustesNuevos", () => {
  const ajustes = parsearAjustes(crudo)

  it("solo los recientes, con ítems y no vistos con la misma huella", () => {
    expect(ajustesNuevos(ajustes, new Map(), "2026-11-15").map((a) => a.id)).toEqual(["10"])
  })

  it("visto con la misma huella: no; editado: sí", () => {
    const a = ajustes[0]
    expect(ajustesNuevos(ajustes, new Map([["10", a.huella]]), "2026-11-15")).toEqual([])
    expect(ajustesNuevos(ajustes, new Map([["10", "otra"]]), "2026-11-15").map((x) => x.id)).toEqual(["10"])
  })
})
