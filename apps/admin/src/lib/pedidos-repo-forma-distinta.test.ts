import { describe, expect, it } from "vitest"
import { toPedidoDto, type PedidoRow } from "./pedidos-repo"

// Datos inventados. El DTO se arma campo por campo: solo importan los que lee `toPedidoDto`.
const fila = (pagoRevision: string | null) =>
  ({
    id: "00000000-0000-0000-0000-000000000001",
    numero: 7,
    createdAt: new Date("2026-10-09T12:00:00Z"),
    estado: "pendiente",
    contactoNombre: "Ana",
    clienteRazonSocial: null,
    entregaTipo: "retiro",
    pagoMetodo: "mercadopago",
    pagoEstado: "pagado",
    total: "1210.00",
    requiereRevision: false,
    motivoRevision: null,
    pagoRevision,
    facturaAlegraId: null,
    sucursal: null,
  }) as unknown as PedidoRow

describe("toPedidoDto: pago_revision", () => {
  it("'forma_distinta' se conserva (no se descarta como desconocido)", () => {
    expect(toPedidoDto(fila("forma_distinta")).pagoRevision).toBe("forma_distinta")
  })

  it("los valores de siempre se conservan y uno desconocido o NULL queda en null", () => {
    expect(toPedidoDto(fila("monto_distinto")).pagoRevision).toBe("monto_distinto")
    expect(toPedidoDto(fila("cuotas_distintas")).pagoRevision).toBe("cuotas_distintas")
    expect(toPedidoDto(fila("algo_nuevo")).pagoRevision).toBeNull()
    expect(toPedidoDto(fila(null)).pagoRevision).toBeNull()
  })
})
