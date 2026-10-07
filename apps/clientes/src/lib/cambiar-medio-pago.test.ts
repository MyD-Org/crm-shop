import { describe, expect, it } from "vitest";
import { precargaDeEntrega, puedeCambiarMedioPago } from "./cambiar-medio-pago";

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

describe("precargaDeEntrega", () => {
  const direcciones = [{ id: "d1", ciudad: "Posadas", direccion: "Av. Siempre Viva 742" }];
  const locales = ["igz", "mdp"];

  it("retiro: el local del pedido si el checkout lo ofrece", () => {
    expect(precargaDeEntrega({ tipo: "retiro", local: "igz", ciudad: null, direccion: null }, direcciones, locales)).toMatchObject({
      opcion: "retiro",
      local: "igz",
    });
    expect(precargaDeEntrega({ tipo: "retiro", local: "otro", ciudad: null, direccion: null }, direcciones, locales).local).toBeNull();
  });

  it("envío: la dirección guardada que coincide (sin importar mayúsculas ni espacios)", () => {
    const p = precargaDeEntrega({ tipo: "envio", local: null, ciudad: "posadas ", direccion: "av. siempre viva 742" }, direcciones, locales);
    expect(p).toMatchObject({ opcion: "domicilio", direccionGuardada: "d1" });
  });

  it("envío a una dirección no guardada: otra dirección con lo tipeado en el pedido", () => {
    const p = precargaDeEntrega({ tipo: "envio", local: null, ciudad: "Oberá", direccion: "Calle Falsa 123" }, direcciones, locales);
    expect(p).toEqual({ opcion: "domicilio", local: null, direccionGuardada: null, tipeada: { ciudad: "Oberá", direccion: "Calle Falsa 123" } });
  });
});
