import { describe, expect, it } from "vitest";
import type { CuentaPagoSnapshot } from "./cuentas-bancarias";
import { cuentaDelPedido } from "./pedido-cuenta-vista";

const snap: CuentaPagoSnapshot = {
  v: 1,
  cuentaId: "c1",
  alias: "tienda.ejemplo",
  cbu: "0000000000000000000000",
  banco: "Banco Ejemplo",
  titular: "Titular Ejemplo SA",
  cuit: "30000000000",
  motivo: "regla",
  sucursal: null,
  totalEvaluado: 100,
  congeladaEn: "2026-10-01T12:00:00.000Z",
};

const base = { pagoMetodoSlug: "transferencia", estado: "pendiente", pagoEstado: "pendiente" } as const;

describe("cuentaDelPedido", () => {
  it("transferencia pendiente con snapshot: muestra lo congelado", () => {
    expect(cuentaDelPedido({ ...base, cuentaPago: snap })).toEqual({ mostrar: true, cuenta: snap });
  });

  it("transferencia sin snapshot (sin cuenta o pedido anterior): mensaje neutro, sin datos", () => {
    expect(cuentaDelPedido({ ...base })).toEqual({ mostrar: true, cuenta: null });
  });

  it("otro medio de pago no muestra nada, aunque tenga snapshot", () => {
    expect(cuentaDelPedido({ ...base, pagoMetodoSlug: "mercadopago", cuentaPago: snap })).toEqual({
      mostrar: false,
      cuenta: null,
    });
    expect(cuentaDelPedido({ ...base, pagoMetodoSlug: undefined })).toEqual({ mostrar: false, cuenta: null });
  });

  it("pedido cancelado o ya pagado: no hay nada que transferir", () => {
    expect(cuentaDelPedido({ ...base, estado: "cancelado", cuentaPago: snap }).mostrar).toBe(false);
    expect(cuentaDelPedido({ ...base, pagoEstado: "pagado", cuentaPago: snap }).mostrar).toBe(false);
  });
});
