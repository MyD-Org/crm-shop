import { describe, expect, it } from "vitest";
import { MENSAJE_REINGRESO_TARJETA, cambioDeCuenta } from "./cuenta-rechazada-cliente";

const config = { cuenta: "igz", publicKey: "TEST-publica-igz" };

describe("cambioDeCuenta (respuesta del cobro que pide tokenizar con otra cuenta)", () => {
  it("cuenta_rechazada: la config de la otra cuenta y el mensaje de reingreso en usted", () => {
    expect(cambioDeCuenta({ motivo: "cuenta_rechazada", error: "x", reintentable: true, config })).toEqual({
      config,
      mensaje: MENSAJE_REINGRESO_TARJETA,
    });
    expect(MENSAJE_REINGRESO_TARJETA).toBe(
      "Hubo un inconveniente técnico con el medio de pago. Vuelva a ingresar los datos de su tarjeta e inténtelo nuevamente.",
    );
  });

  it("cuenta_no_valida: la config vigente y el mensaje del servidor", () => {
    expect(cambioDeCuenta({ motivo: "cuenta_no_valida", error: "La configuración del pago cambió.", config })).toEqual({
      config,
      mensaje: "La configuración del pago cambió.",
    });
  });

  it("conserva la base de Payway", () => {
    expect(cambioDeCuenta({ motivo: "cuenta_rechazada", config: { ...config, baseUrl: "https://payway.example" } })?.config).toEqual({
      ...config,
      baseUrl: "https://payway.example",
    });
  });

  it("cualquier otra respuesta no cambia la key (un rechazo del pago, un pago en curso, sin config)", () => {
    expect(cambioDeCuenta({ estado: "fallido", motivo: "fondos_insuficientes", config })).toBeNull();
    expect(cambioDeCuenta({ motivo: "pago_en_curso" })).toBeNull();
    expect(cambioDeCuenta({ motivo: "cuenta_rechazada" })).toBeNull();
    expect(cambioDeCuenta({ motivo: "cuenta_rechazada", config: { cuenta: "igz", publicKey: "" } })).toBeNull();
    expect(cambioDeCuenta(null)).toBeNull();
  });
});
