import { describe, expect, it } from "vitest";
import { armarOrder, type FilaOrder } from "./pedidos";
import type { CuentaPagoSnapshot } from "./cuentas-bancarias";

const snap: CuentaPagoSnapshot = {
  v: 1,
  cuentaId: "c1",
  alias: "tienda.ejemplo",
  cbu: "0000000000000000000000",
  banco: "Banco Ejemplo",
  titular: "Titular Ejemplo SA",
  cuit: "30000000000",
  motivo: "regla",
  sucursal: "mdp",
  totalEvaluado: 1210,
  congeladaEn: "2026-10-01T12:00:00.000Z",
};

const fila = (pagoCuenta: CuentaPagoSnapshot | null) =>
  ({
    id: "p-1",
    numero: 1042,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    estado: "pendiente",
    pagoEstado: "pendiente",
    pagoMetodo: "transferencia",
    entregaTipo: "retiro",
    entregaCiudad: null,
    entregaDireccion: null,
    subtotal: "1000.00",
    iva: "210.00",
    costoEnvio: "0.00",
    total: "1210.00",
    pagoCuenta,
  }) as unknown as FilaOrder;

describe("armarOrder: cuenta congelada", () => {
  it("expone el snapshot del pedido tal cual, sin releer la cuenta", () => {
    expect(armarOrder(fila(snap), []).cuentaPago).toEqual(snap);
  });

  it("sin snapshot (NULL) no hay cuentaPago: las vistas muestran el mensaje neutro", () => {
    expect(armarOrder(fila(null), [])).not.toHaveProperty("cuentaPago");
  });
});
