import { describe, expect, it } from "vitest";
import { puedeCancelarPedido } from "./pedido-cancelable";

const base = { estado: "pendiente", pagoEstado: "pendiente" } as const;

describe("puedeCancelarPedido", () => {
  it("con un comprobante informado: no, aunque el pago siga pendiente", () => {
    expect(puedeCancelarPedido({ ...base, comprobanteInformado: true })).toBe(false);
    expect(puedeCancelarPedido({ ...base, comprobanteInformado: false })).toBe(true);
  });

  it("pendiente y sin pagar: se puede, cualquiera sea el medio de pago", () => {
    expect(puedeCancelarPedido(base)).toBe(true);
    expect(puedeCancelarPedido({ ...base, pagoEstado: "fallido" })).toBe(true);
  });

  it("pagado: no", () => {
    expect(puedeCancelarPedido({ ...base, pagoEstado: "pagado" })).toBe(false);
  });

  it("facturado: no", () => {
    expect(puedeCancelarPedido({ ...base, facturaId: "f1" })).toBe(false);
    expect(puedeCancelarPedido({ ...base, facturaNumero: "A-1" })).toBe(false);
  });

  it("fuera de pendiente: no", () => {
    for (const estado of ["confirmado", "cancelado", "entregado"]) {
      expect(puedeCancelarPedido({ ...base, estado } as never)).toBe(false);
    }
  });
});
