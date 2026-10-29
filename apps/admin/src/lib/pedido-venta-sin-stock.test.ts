import { describe, it, expect } from "vitest"
import { lineasFaltaStock, textoLineaAPedido, tituloAPedido } from "./pedido-venta-sin-stock"
import type { PedidoItemDto } from "./pedidos-repo"

const v = { modalidadId: "m1", nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" as const }

let n = 0
const item = (over: Partial<PedidoItemDto>): PedidoItemDto => ({
  id: String(++n),
  alegraItemId: "a",
  code: null,
  name: "Producto",
  brand: null,
  qty: 1,
  precioUnitario: 1,
  ivaPorcentaje: 21,
  subtotal: 1,
  iva: 0,
  total: 1,
  stockActual: 5,
  precioNormal: null,
  campaniaNombre: null,
  aTraerDe: null,
  ventaSinStock: null,
  ...over,
})

describe("pedido-venta-sin-stock", () => {
  it("texto de la línea", () => {
    expect(textoLineaAPedido(v)).toBe("A pedido · Modalidad 48 h · 2 días hábiles")
    expect(textoLineaAPedido({ ...v, plazoDias: 1 })).toBe("A pedido · Modalidad 48 h · 1 día hábil")
    expect(textoLineaAPedido({ ...v, plazoDias: null })).toBe("A pedido · Modalidad 48 h · a coordinar")
  })
  it("Falta stock no cuenta las líneas a pedido", () => {
    n = 0
    expect(
      lineasFaltaStock([
        item({ stockActual: 0, qty: 2, ventaSinStock: v }),
        item({ stockActual: 0, qty: 1, ventaSinStock: null }),
        item({ stockActual: null, qty: 1 }),
        item({ stockActual: 9, qty: 1 }),
      ]).map((i) => i.id),
    ).toEqual(["2"])
  })
  it("título", () => expect([tituloAPedido(1), tituloAPedido(3)]).toEqual(["1 producto a pedido", "3 productos a pedido"]))
})
