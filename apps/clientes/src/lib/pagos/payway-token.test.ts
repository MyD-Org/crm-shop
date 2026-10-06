import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenizarTarjeta, MENSAJE_TOKEN } from "./payway-token";
import { armarSolicitudToken } from "./payway-tarjeta";

const CONFIG = { baseUrl: "https://payway.example", publicKey: "clave-publica-de-prueba" };
const SOLICITUD = armarSolicitudToken({
  pan: "4507990000004905",
  mes: "08",
  anio: "30",
  cvv: "123",
  titular: "Juan Perez",
  nroDoc: "25123456",
});

const TOKEN_OK = {
  id: "7c0b0a6e-1d52-4a5e-9d3f-0c1f3a4b5c6d",
  bin: "450799",
  status: "active",
  last_four_digits: "4905",
};

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("tokenizarTarjeta", () => {
  it("POST /api/v2/tokens con la key pública en el header y devuelve token y bin", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(201, TOKEN_OK));
    const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f });
    expect(r).toEqual({ ok: true, token: TOKEN_OK.id, bin: "450799" });

    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://payway.example/api/v2/tokens");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("clave-publica-de-prueba");
    expect(init.headers["Content-Type"]).toBe("application/json");
    // Cookies de nuestro sitio fuera: es otro origen.
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body)).toEqual(SOLICITUD);
  });

  it("tolera una base con barra final o con /api/v2", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(201, TOKEN_OK));
    await tokenizarTarjeta(SOLICITUD, { ...CONFIG, baseUrl: "https://payway.example/" }, { fetch: f });
    await tokenizarTarjeta(SOLICITUD, { ...CONFIG, baseUrl: "https://payway.example/api/v2" }, { fetch: f });
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://payway.example/api/v2/tokens",
      "https://payway.example/api/v2/tokens",
    ]);
  });

  it("400 (datos de tarjeta inválidos) -> datos_invalidos", async () => {
    const f = vi.fn().mockResolvedValue(
      respuesta(400, {
        error_type: "invalid_request_error",
        validation_errors: [{ code: "CardData", param: "expired card" }],
      }),
    );
    const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f });
    expect(r).toEqual({ ok: false, motivo: "datos_invalidos", mensaje: MENSAJE_TOKEN.datos_invalidos });
  });

  it.each([401, 403])("%i (credenciales o habilitación) -> configuracion, sin culpar al comprador", async (status) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn().mockResolvedValue(respuesta(status, { message: "Invalid authentication credentials" }));
    const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f });
    expect(r).toEqual({ ok: false, motivo: "configuracion", mensaje: MENSAJE_TOKEN.configuracion });
    // Deja rastro del problema de configuración, sin datos de tarjeta.
    const logueado = JSON.stringify(log.mock.calls);
    expect(logueado).not.toContain("4507990000004905");
    expect(logueado).not.toContain("123");
    expect(logueado).not.toContain("clave-publica-de-prueba");
  });

  it("falla de red o CORS (fetch rechaza) -> red, y aclara que no se cobró", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f });
    expect(r).toEqual({ ok: false, motivo: "red", mensaje: MENSAJE_TOKEN.red });
    expect(MENSAJE_TOKEN.red).toMatch(/no se realizó ningún cobro/i);
    expect(JSON.stringify(log.mock.calls)).not.toContain("4507990000004905");
  });

  it("timeout -> red", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal!.addEventListener("abort", () => rej(new DOMException("abort", "AbortError")));
      }),
    );
    const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f as unknown as typeof fetch, timeoutMs: 10 });
    expect(r).toMatchObject({ ok: false, motivo: "red" });
  });

  it("5xx -> red (reintentable)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn().mockResolvedValue(respuesta(503, {}));
    const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f });
    expect(r).toMatchObject({ ok: false, motivo: "red" });
  });

  it("201 con cuerpo inesperado (sin id o sin bin de 6 dígitos) -> configuracion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const cuerpo of [{}, { id: TOKEN_OK.id }, { id: TOKEN_OK.id, bin: "12" }, { id: "", bin: "450799" }]) {
      const f = vi.fn().mockResolvedValue(respuesta(201, cuerpo));
      const r = await tokenizarTarjeta(SOLICITUD, CONFIG, { fetch: f });
      expect(r).toMatchObject({ ok: false, motivo: "configuracion" });
    }
  });

  it("sin configuración (base inválida o sin key) no hace ninguna llamada", async () => {
    const f = vi.fn();
    expect(await tokenizarTarjeta(SOLICITUD, { baseUrl: "http://payway.example", publicKey: "k" }, { fetch: f })).toMatchObject({
      ok: false,
      motivo: "configuracion",
    });
    expect(await tokenizarTarjeta(SOLICITUD, { baseUrl: "https://payway.example", publicKey: "" }, { fetch: f })).toMatchObject({
      ok: false,
      motivo: "configuracion",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("los mensajes están en usted", () => {
    for (const m of Object.values(MENSAJE_TOKEN)) {
      expect(m).not.toMatch(/\b(tu|tus|vos|probá|revisá)\b/i);
    }
  });
});
