import { afterEach, describe, expect, it, vi } from "vitest";
import * as registro from "./index";
import { idsProveedores, procesadorConfigurado, proveedorPago, rasgosProcesador } from "./index";

describe("registro de proveedores de pago", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resuelve por id y cuenta; null para desconocidos o vacíos", () => {
    const mp = proveedorPago("mercadopago", "igz");
    expect(mp?.id).toBe("mercadopago");
    expect(mp?.cuenta).toBe("igz");
    expect(proveedorPago("desconocido", "igz")).toBeNull();
    expect(proveedorPago(null, "igz")).toBeNull();
    expect(proveedorPago("", "igz")).toBeNull();
    expect(proveedorPago("constructor", "igz")).toBeNull();
  });

  it("memoiza por id y cuenta: misma cuenta, misma instancia; otra cuenta, otra", () => {
    expect(proveedorPago("payway", "mdp")).toBe(proveedorPago("payway", "mdp"));
    expect(proveedorPago("payway", "mdp")).not.toBe(proveedorPago("payway", "igz"));
    expect(proveedorPago("payway", "mdp")?.cuenta).toBe("mdp");
  });

  it("la cuenta es obligatoria y ya no hay singletons", () => {
    // @ts-expect-error: sin cuenta no hay proveedor.
    void proveedorPago("mercadopago");
    expect("mercadoPago" in registro).toBe(false);
    expect("payway" in registro).toBe(false);
  });

  it("mercadopago expone configurado(), verificarWebhook() y urlNotificacion()", () => {
    const mp = proveedorPago("mercadopago", "igz")!;
    expect(typeof mp.configurado).toBe("function");
    expect(typeof mp.verificarWebhook).toBe("function");
    expect(typeof mp.urlNotificacion).toBe("function");
  });

  it("configurado() es por cuenta", () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-t");
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-p");
    expect(proveedorPago("mercadopago", "igz")!.configurado()).toBe(true);
    expect(proveedorPago("mercadopago", "mdp")!.configurado()).toBe(false);
  });

  it("procesadorConfigurado: alcanza con UNA cuenta completa", () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-t");
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-p");
    expect(procesadorConfigurado("mercadopago")).toBe(true);
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "");
    expect(procesadorConfigurado("mercadopago")).toBe(false);
  });

  it("procesadorConfigurado: las variables sin sufijo ya no cuentan", () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-t");
    vi.stubEnv(["NEXT", "PUBLIC", "MP", "PUBLIC", "KEY"].join("_"), "TEST-p");
    expect(procesadorConfigurado("mercadopago")).toBe(false);
  });

  it("procesadorConfigurado: un procesador que no está registrado nunca está configurado", () => {
    expect(procesadorConfigurado("desconocido")).toBe(false);
    expect(procesadorConfigurado("")).toBe(false);
  });

  it("payway está registrado, junto a mercadopago, con sus rasgos", () => {
    expect(idsProveedores()).toEqual(["mercadopago", "payway"]);
    expect(rasgosProcesador("payway")).toEqual({ requiereBin: true, requiereAntifraude: true, conWebhook: false });
    expect(rasgosProcesador("mercadopago")).toEqual({ requiereBin: false, requiereAntifraude: false, conWebhook: true });
    expect(rasgosProcesador("desconocido")).toBeNull();
  });

  it("procesadorConfigurado('payway') con una cuenta completa (privada + pública) y la base https", () => {
    expect(procesadorConfigurado("payway")).toBe(false);
    vi.stubEnv("PAYWAY_API_PRIVATE_KEY_MDP", "clave-privada-de-prueba");
    vi.stubEnv("PAYWAY_API_PUBLIC_KEY_MDP", "clave-publica-de-prueba");
    expect(procesadorConfigurado("payway")).toBe(false); // falta la base
    vi.stubEnv("PAYWAY_BASE_URL", "https://payway.example");
    expect(procesadorConfigurado("payway")).toBe(true);
    vi.stubEnv("PAYWAY_API_PRIVATE_KEY_MDP", "");
    expect(procesadorConfigurado("payway")).toBe(false);
  });
});
