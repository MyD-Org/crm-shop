import { describe, expect, it } from "vitest"
import { aCentavos, deCentavos, mergearPrecios } from "./alegra-precios-motor"

describe("aCentavos", () => {
  it("pasa montos exactos a centavos enteros", () => {
    expect(aCentavos(160)).toBe(16000)
    expect(aCentavos("160.00")).toBe(16000)
    expect(aCentavos("160.01")).toBe(16001)
    expect(aCentavos(0.1 + 0.2)).toBe(30)
    expect(aCentavos("0")).toBe(0)
  })

  it("redondea half-up sobre la representación decimal", () => {
    expect(aCentavos("160.005")).toBe(16001)
    expect(aCentavos(160.005)).toBe(16001)
    expect(aCentavos("160.004")).toBe(16000)
    expect(aCentavos("1.005")).toBe(101)
    expect(aCentavos("-1.005")).toBe(-101)
  })

  it("null, vacío y no numérico dan null", () => {
    expect(aCentavos(null)).toBeNull()
    expect(aCentavos(undefined)).toBeNull()
    expect(aCentavos("")).toBeNull()
    expect(aCentavos("abc")).toBeNull()
    expect(aCentavos(Number.NaN)).toBeNull()
  })

  it("deCentavos vuelve a 2 decimales exactos", () => {
    expect(deCentavos(16001)).toBe(160.01)
    expect(deCentavos(aCentavos("33.33") as number)).toBe(33.33)
  })
})

describe("mergearPrecios", () => {
  const actuales = [
    { idPriceList: 1, price: 100 },
    { idPriceList: 2, price: 200 },
    { idPriceList: 7, price: 700 },
  ]

  it("reemplaza la lista destino y conserva las ajenas tal cual", () => {
    const r = mergearPrecios(actuales, [{ id: "2", price: 250.5 }])
    expect(r).toEqual([
      { idPriceList: 1, price: 100 },
      { idPriceList: 2, price: 250.5 },
      { idPriceList: 7, price: 700 },
    ])
  })

  it("conserva el tipo del idPriceList (número o texto)", () => {
    const r = mergearPrecios([{ idPriceList: "1", price: 10 }], [{ id: "1", price: 11 }])
    expect(r).toEqual([{ idPriceList: "1", price: 11 }])
    expect(typeof r[0].idPriceList).toBe("string")
  })

  it("agrega una lista nueva con el tipo que usan las demás", () => {
    expect(mergearPrecios(actuales, [{ id: "9", price: 90 }]).at(-1)).toEqual({ idPriceList: 9, price: 90 })
    expect(mergearPrecios([{ idPriceList: "1", price: 10 }], [{ id: "9", price: 90 }]).at(-1)).toEqual({ idPriceList: "9", price: 90 })
    expect(mergearPrecios([], [{ id: "9", price: 90 }])).toEqual([{ idPriceList: 9, price: 90 }])
  })

  it("redondea a 2 decimales half-up y no muta la entrada", () => {
    const copia = JSON.parse(JSON.stringify(actuales))
    const r = mergearPrecios(actuales, [{ id: "1", price: 160.005 }])
    expect(r[0].price).toBe(160.01)
    expect(actuales).toEqual(copia)
  })

  it("rechaza un precio no numérico", () => {
    expect(() => mergearPrecios(actuales, [{ id: "1", price: Number.NaN }])).toThrow()
  })
})
