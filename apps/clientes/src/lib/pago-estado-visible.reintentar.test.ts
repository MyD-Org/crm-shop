import { describe, expect, it } from "vitest";
import { puedeReintentarPago } from "./pago-estado-visible";

describe("puedeReintentarPago", () => {
  const base = { estado: "pendiente", pagoEstado: "fallido", pagoMetodoSlug: "mercadopago" } as const;

  it("sí: pago en línea rechazado y pedido pendiente", () => {
    expect(puedeReintentarPago(base)).toBe(true);
  });

  it("no: pedido cancelado, pago no rechazado o medio fuera de línea", () => {
    expect(puedeReintentarPago({ ...base, estado: "cancelado" })).toBe(false);
    expect(puedeReintentarPago({ ...base, pagoEstado: "pendiente" })).toBe(false);
    expect(puedeReintentarPago({ ...base, pagoMetodoSlug: "transferencia" })).toBe(false);
  });
});
