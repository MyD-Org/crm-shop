import { describe, expect, it } from "vitest";
import { pagoAEnviar, pasosCheckout } from "./checkout-flujo";

describe("checkout según el flujo del pedido", () => {
  it("pasos y pago a confirmar", () => {
    expect(pasosCheckout({ flujo: "a_confirmar", esCuentaCorriente: false })).toEqual(["datos", "entrega"]);
    expect(pasosCheckout({ flujo: "a_confirmar", esCuentaCorriente: true })).toEqual(["datos", "entrega", "pago"]);
    expect(pagoAEnviar({ flujo: "a_confirmar", esCuentaCorriente: false, medioSlug: "mercadopago" })).toBe("a_coordinar");
    expect(pagoAEnviar({ flujo: "normal", esCuentaCorriente: false, medioSlug: "mercadopago" })).toBe("mercadopago");
  });

  it("flujo normal: los tres pasos y el medio elegido (o a_coordinar si ninguno aplica), como hoy", () => {
    expect(pasosCheckout({ flujo: "normal", esCuentaCorriente: false })).toEqual(["datos", "entrega", "pago"]);
    expect(pasosCheckout({ flujo: "normal", esCuentaCorriente: true })).toEqual(["datos", "entrega", "pago"]);
    expect(pagoAEnviar({ flujo: "normal", esCuentaCorriente: false, medioSlug: null })).toBe("a_coordinar");
  });

  it("cuenta corriente a confirmar: sigue con su medio", () => {
    expect(pagoAEnviar({ flujo: "a_confirmar", esCuentaCorriente: true, medioSlug: "cuenta-corriente" })).toBe("cuenta-corriente");
    expect(pagoAEnviar({ flujo: "a_confirmar", esCuentaCorriente: true, medioSlug: null })).toBe("a_coordinar");
  });
});
