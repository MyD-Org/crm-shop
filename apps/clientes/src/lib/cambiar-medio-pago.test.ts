import { describe, expect, it } from "vitest";
import { puedeCambiarMedioPago, pasoAlCambiarMedio } from "./cambiar-medio-pago";

describe("puedeCambiarMedioPago", () => {
  it("con el formulario de pago sin enviar o tras un rechazo, sí", () => {
    expect(puedeCambiarMedioPago({ pagado: false, pagoEnConfirmacion: false })).toBe(true);
  });
  it("con el cobro en confirmación (en vuelo), no", () => {
    expect(puedeCambiarMedioPago({ pagado: false, pagoEnConfirmacion: true })).toBe(false);
  });
  it("con el pago aprobado, no", () => {
    expect(puedeCambiarMedioPago({ pagado: true, pagoEnConfirmacion: false })).toBe(false);
  });
});

describe("pasoAlCambiarMedio", () => {
  it("con el estado cargado en esta visita vuelve al paso Pago", () => {
    expect(pasoAlCambiarMedio({ estadoCargado: true })).toBe("pago");
  });
  it("con un pedido retomado (sin el estado del formulario) vuelve al inicio del checkout", () => {
    expect(pasoAlCambiarMedio({ estadoCargado: false })).toBe("datos");
  });
});
