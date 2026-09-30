import { describe, it, expect } from "vitest"
import { toPedidoDetalleDto, type PedidoItemRow, type PedidoRow } from "./pedidos-repo"

// El DTO del detalle arma cada ítem campo por campo. Acá se fija lo que decide el ROL:
// `costoUnitario` sólo existe con `incluirCosto`; `stockActual` viaja siempre. Datos inventados.

const pedido = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "tenant-a",
  numero: 12,
  estado: "pendiente",
  createdAt: new Date("2026-09-29T12:00:00Z"),
  updatedAt: new Date("2026-09-29T12:00:00Z"),
  contactoNombre: "Carla Compradora",
  contactoTelefono: "+54 11 5555-0100",
  entregaTipo: "retiro",
  pagoMetodo: "a_coordinar",
  pagoEstado: "pendiente",
  subtotal: "1000.00",
  iva: "210.00",
  costoEnvio: "0.00",
  total: "1210.00",
  requiereRevision: false,
  facturadoEn: null,
  reservaVenceEn: null,
} as unknown as PedidoRow

const item = (over: Record<string, unknown> = {}): PedidoItemRow =>
  ({
    id: "i1",
    orderId: pedido.id,
    alegraItemId: "art-1",
    code: "COD-1",
    name: "Producto Uno",
    brand: null,
    qty: "3.000",
    precioUnitario: "100.00",
    ivaPorcentaje: "21.00",
    subtotal: "300.00",
    iva: "63.00",
    total: "363.00",
    aTraerDe: null,
    ...over,
  }) as PedidoItemRow

describe("toPedidoDetalleDto: stock y costo del ítem", () => {
  const conCatalogo = item({ catalogoStock: "7", catalogoCosto: "277.9" })

  it("sin incluirCosto (operator) el ítem trae el stock y NO tiene la clave costoUnitario", () => {
    const [dto] = toPedidoDetalleDto(pedido, [conCatalogo]).items
    expect(dto.stockActual).toBe(7)
    expect(dto).not.toHaveProperty("costoUnitario")
  })

  it("con incluirCosto (admin+) trae el costo como número", () => {
    const [dto] = toPedidoDetalleDto(pedido, [conCatalogo], null, [], null, { incluirCosto: true }).items
    expect(dto).toMatchObject({ stockActual: 7, costoUnitario: 277.9 })
  })

  it("sin dato del espejo (producto fuera del catálogo o fila pelada) da null, nunca 0", () => {
    const [sinJoin, pelado] = toPedidoDetalleDto(
      pedido,
      [item({ catalogoStock: null, catalogoCosto: null }), item({ id: "i2" })],
      null,
      [],
      null,
      { incluirCosto: true },
    ).items
    expect(sinJoin).toMatchObject({ stockActual: null, costoUnitario: null })
    expect(pelado).toMatchObject({ stockActual: null, costoUnitario: null })
  })

  it("un unitCost no numérico en el raw de Alegra no rompe: queda null", () => {
    const [dto] = toPedidoDetalleDto(pedido, [item({ catalogoStock: "abc", catalogoCosto: "" })], null, [], null, {
      incluirCosto: true,
    }).items
    expect(dto).toMatchObject({ stockActual: null, costoUnitario: null })
  })
})

describe("esPagoManual con medios configurables", () => {
  it("lista fija, o slug manual del tenant; nunca con proveedor de pago", async () => {
    const { esPagoManual } = await import("./pedidos-repo")
    expect(esPagoManual({ pagoMetodo: "efectivo", pagoProveedor: null })).toBe(true)
    expect(esPagoManual({ pagoMetodo: "tarjeta-local", pagoProveedor: null })).toBe(false)
    expect(esPagoManual({ pagoMetodo: "tarjeta-local", pagoProveedor: null }, ["tarjeta-local"])).toBe(true)
    expect(esPagoManual({ pagoMetodo: "tarjeta-local", pagoProveedor: "mobbex" }, ["tarjeta-local"])).toBe(false)
    expect(esPagoManual({ pagoMetodo: "efectivo", pagoProveedor: "modo" })).toBe(false)
  })
})
