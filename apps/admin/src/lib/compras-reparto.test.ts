import { describe, expect, it } from "vitest"
import { prng } from "./__fixtures__/prng"
import { ErrorCompras, totalDeLineasCentavos } from "./compras-dinero"
import {
  bpPorTax,
  construirLineasCreacion,
  construirLineasRecepcion,
  hashSnapshot,
  normalizarSnapshot,
  totalEsperadoCentavos,
  validarRecepcion,
  type ItemReparto,
} from "./compras-reparto"

const TRANSITO = "5246"

const item = (p: Partial<ItemReparto> & { itemIdCuenta: string }): ItemReparto => ({
  costoCentavos: 10_000,
  cantidadPedidaMilesimas: 10_000,
  taxId: "1",
  ivaBp: 2100,
  ...p,
})

const neto = (lineas: { precioCentavos: number; cantidadMilesimas: number }[]) =>
  lineas.reduce((a, l) => a + BigInt(l.precioCentavos) * BigInt(l.cantidadMilesimas), BigInt(0))

describe("construirLineasCreacion", () => {
  it("una línea de tránsito por alícuota, ordenadas por impuesto", () => {
    const items = [
      item({ itemIdCuenta: "a", taxId: "3", ivaBp: 1050, costoCentavos: 2002, cantidadPedidaMilesimas: 1000 }),
      item({ itemIdCuenta: "b", taxId: "1", ivaBp: 2100, costoCentavos: 1001, cantidadPedidaMilesimas: 2000 }),
      item({ itemIdCuenta: "c", taxId: "1", ivaBp: 2100, costoCentavos: 500, cantidadPedidaMilesimas: 1000 }),
    ]
    const l = construirLineasCreacion(items, TRANSITO)
    expect(l).toEqual([
      { tipo: "cat", id: TRANSITO, precioCentavos: 2502, cantidadMilesimas: 1000, taxIds: ["1"] },
      { tipo: "cat", id: TRANSITO, precioCentavos: 2002, cantidadMilesimas: 1000, taxIds: ["3"] },
    ])
  })

  it("misma alícuota -> una sola línea (caso común)", () => {
    const l = construirLineasCreacion([item({ itemIdCuenta: "a" }), item({ itemIdCuenta: "b" })], TRANSITO)
    expect(l).toHaveLength(1)
    expect(l[0].precioCentavos).toBe(200_000)
  })

  it("rechaza una compra sin importe neto", () => {
    expect(() => construirLineasCreacion([item({ itemIdCuenta: "a", costoCentavos: 0 })], TRANSITO)).toThrow(ErrorCompras)
    expect(() => construirLineasCreacion([], TRANSITO)).toThrow(ErrorCompras)
  })
})

describe("construirLineasRecepcion", () => {
  it("escenario del spec: 10 u a 100,00, se reciben 4 -> ítem 400,00 y tránsito 600,00", () => {
    const items = [item({ itemIdCuenta: "a" })]
    const l = construirLineasRecepcion(items, [4_000], TRANSITO)
    expect(l).toEqual([
      { tipo: "item", id: "a", precioCentavos: 10_000, cantidadMilesimas: 4_000, taxIds: ["1"] },
      { tipo: "cat", id: TRANSITO, precioCentavos: 60_000, cantidadMilesimas: 1000, taxIds: ["1"] },
    ])
    expect(totalDeLineasCentavos(l, bpPorTax(items))).toBe(totalEsperadoCentavos(items, []))
    expect(totalEsperadoCentavos(items, [])).toBe(121_000)
  })

  it("recepción total: desaparece el tránsito y quedan sólo ítems", () => {
    const items = [item({ itemIdCuenta: "a" })]
    const l = construirLineasRecepcion(items, [10_000], TRANSITO)
    expect(l.map((x) => x.tipo)).toEqual(["item"])
  })

  it("sin recibir nada equivale a la creación (el ítem sin recibir no tiene línea)", () => {
    const items = [item({ itemIdCuenta: "a" }), item({ itemIdCuenta: "b", taxId: "3", ivaBp: 1050 })]
    expect(construirLineasRecepcion(items, [0, 0], TRANSITO)).toEqual(construirLineasCreacion(items, TRANSITO))
  })

  it("redondeo 33,33: el total esperado no cambia con cantidades fraccionarias", () => {
    const items = [item({ itemIdCuenta: "a", costoCentavos: 3_333, cantidadPedidaMilesimas: 7_777 })]
    const original = totalEsperadoCentavos(items, [])
    for (const q of [1, 333, 1_111, 4_321, 7_776, 7_777]) {
      const l = construirLineasRecepcion(items, [q], TRANSITO)
      expect(totalDeLineasCentavos(l, bpPorTax(items))).toBe(original)
    }
  })

  it("rechaza recibir más que lo pedido", () => {
    expect(() => construirLineasRecepcion([item({ itemIdCuenta: "a" })], [10_001], TRANSITO)).toThrow(ErrorCompras)
  })

  it("las percepciones no son líneas: el total esperado las suma aparte", () => {
    const items = [item({ itemIdCuenta: "a" })]
    expect(totalEsperadoCentavos(items, [3_000, 1_500])).toBe(121_000 + 4_500)
    const antes = construirLineasRecepcion(items, [0], TRANSITO)
    const despues = construirLineasRecepcion(items, [5_000], TRANSITO)
    expect([...antes, ...despues].every((x) => x.tipo === "item" || x.id === TRANSITO)).toBe(true)
  })

  it("propiedad (semilla fija): neto por alícuota constante, tránsito >= 0, monotonía y total igual al original", () => {
    const r = prng(77_001)
    const taxes = [
      { taxId: "1", ivaBp: 2100 },
      { taxId: "3", ivaBp: 1050 },
      { taxId: "4", ivaBp: 0 },
    ]
    for (let caso = 0; caso < 300; caso++) {
      const n = 1 + Math.floor(r() * 5)
      const items = Array.from({ length: n }, (_, i) =>
        item({
          itemIdCuenta: `i${i}`,
          costoCentavos: 1 + Math.floor(r() * 500_000),
          cantidadPedidaMilesimas: 1 + Math.floor(r() * 40_000),
          ...taxes[Math.floor(r() * 3)],
        }),
      )
      const original = totalEsperadoCentavos(items, [])
      const bp = bpPorTax(items)
      const recibidas = items.map(() => 0)
      let netoTransitoPrevio: Map<string, bigint> | null = null
      for (let paso = 0; paso < 6; paso++) {
        // recepción parcial aleatoria sobre lo pendiente
        for (let i = 0; i < n; i++) {
          const pend = items[i].cantidadPedidaMilesimas - recibidas[i]
          recibidas[i] += Math.floor(r() * (pend + 1) * (paso === 5 ? 1 : 0.6))
          recibidas[i] = Math.min(recibidas[i], items[i].cantidadPedidaMilesimas)
        }
        const l = construirLineasRecepcion(items, recibidas, TRANSITO)
        expect(totalDeLineasCentavos(l, bp)).toBe(original)
        // neto por alícuota constante
        for (const t of taxes) {
          const delTax = l.filter((x) => x.taxIds[0] === t.taxId)
          const esperado = items
            .filter((i) => i.taxId === t.taxId)
            .reduce((a, i) => a + BigInt(i.costoCentavos) * BigInt(i.cantidadPedidaMilesimas), BigInt(0))
          expect(neto(delTax)).toBe(esperado)
        }
        // tránsito por alícuota: nunca negativo y no creciente
        const tr = new Map<string, bigint>()
        for (const x of l.filter((y) => y.tipo === "cat")) tr.set(x.taxIds[0], neto([x]))
        for (const v of tr.values()) expect(v > BigInt(0)).toBe(true)
        if (netoTransitoPrevio) {
          for (const [k, v] of tr) expect(v <= (netoTransitoPrevio.get(k) ?? BigInt(0))).toBe(true)
        }
        netoTransitoPrevio = tr
        // una sola línea de tránsito por alícuota
        expect(new Set(l.filter((y) => y.tipo === "cat").map((y) => y.taxIds[0])).size).toBe(
          l.filter((y) => y.tipo === "cat").length,
        )
      }
      // al completar todo, el tránsito es 0
      const total = construirLineasRecepcion(items, items.map((i) => i.cantidadPedidaMilesimas), TRANSITO)
      expect(total.some((x) => x.tipo === "cat")).toBe(false)
      expect(totalDeLineasCentavos(total, bp)).toBe(original)
    }
  })
})

describe("validarRecepcion", () => {
  const items = [item({ itemIdCuenta: "a", cantidadPedidaMilesimas: 5_000 })]

  it("sin cantidades", () => {
    expect(() => validarRecepcion(items, [0], [0])).toThrow("Indique al menos una cantidad recibida.")
  })

  it("sobre-entrega", () => {
    expect(() => validarRecepcion(items, [3_000], [2_001])).toThrow(
      "La cantidad recibida supera la pendiente. Para mercadería adicional, cargue otra compra.",
    )
  })

  it("acepta exactamente lo pendiente y devuelve el acumulado", () => {
    expect(validarRecepcion(items, [3_000], [2_000])).toEqual([5_000])
  })

  it("rechaza cantidades negativas o con decimales sobre las milésimas", () => {
    expect(() => validarRecepcion(items, [0], [-1])).toThrow(ErrorCompras)
    expect(() => validarRecepcion(items, [0], [0.5])).toThrow(ErrorCompras)
  })
})

describe("snapshot y hash", () => {
  const a = { tipo: "item" as const, id: "10", precioCentavos: 100, cantidadMilesimas: 1000, taxIds: ["1"] }
  const b = { tipo: "cat" as const, id: TRANSITO, precioCentavos: 500, cantidadMilesimas: 1000, taxIds: ["1"] }

  it("el hash no depende del orden de las líneas ni de los nombres", () => {
    const h1 = hashSnapshot(normalizarSnapshot([a, b], 726))
    const h2 = hashSnapshot(normalizarSnapshot([{ ...b, nombre: "Tránsito" }, { ...a, nombre: "Cable" }], 726))
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("ordena los taxIds y cambia si cambia una cantidad, un precio, un id o el total", () => {
    const base = hashSnapshot(normalizarSnapshot([a, b], 726))
    expect(hashSnapshot(normalizarSnapshot([{ ...a, taxIds: ["3", "1"] }, b], 726))).toBe(
      hashSnapshot(normalizarSnapshot([{ ...a, taxIds: ["1", "3"] }, b], 726)),
    )
    expect(hashSnapshot(normalizarSnapshot([{ ...a, cantidadMilesimas: 2000 }, b], 726))).not.toBe(base)
    expect(hashSnapshot(normalizarSnapshot([{ ...a, precioCentavos: 101 }, b], 726))).not.toBe(base)
    expect(hashSnapshot(normalizarSnapshot([{ ...a, id: "11" }, b], 726))).not.toBe(base)
    expect(hashSnapshot(normalizarSnapshot([a, b], 727))).not.toBe(base)
  })

  it("el hash es estable entre versiones (valor fijo de referencia)", () => {
    expect(hashSnapshot(normalizarSnapshot([a, b], 726))).toBe(
      "7ece998d71c8babf0c4e0da1bae6d33a868a756298369ff8d99c86087e3be816",
    )
  })
})
