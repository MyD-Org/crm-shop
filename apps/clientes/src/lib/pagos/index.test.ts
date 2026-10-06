import { afterEach, describe, expect, it, vi } from "vitest";
import { mercadoPago } from "./mercadopago";
import { procesadorConfigurado, proveedorPago } from "./index";

describe("registro de proveedores de pago", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resuelve mercadopago por id y devuelve null para desconocidos o vacíos", () => {
    expect(proveedorPago("mercadopago")).toBe(mercadoPago);
    expect(proveedorPago("desconocido")).toBeNull();
    expect(proveedorPago(null)).toBeNull();
    expect(proveedorPago("")).toBeNull();
    expect(proveedorPago("constructor")).toBeNull();
  });

  it("mercadopago expone configurado() y verificarWebhook()", () => {
    expect(typeof mercadoPago.configurado).toBe("function");
    expect(typeof mercadoPago.verificarWebhook).toBe("function");
    expect(typeof mercadoPago.urlNotificacion).toBe("function");
  });

  it("procesadorConfigurado: con credenciales sí, sin ellas no", () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "tok");
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "pub");
    expect(procesadorConfigurado("mercadopago")).toBe(true);
    vi.stubEnv("MP_ACCESS_TOKEN", "");
    expect(procesadorConfigurado("mercadopago")).toBe(false);
  });

  it("procesadorConfigurado: un procesador que no está registrado nunca está configurado", () => {
    expect(procesadorConfigurado("payway")).toBe(false);
    expect(procesadorConfigurado("")).toBe(false);
  });
});
