import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tokenizarTarjeta,
  tokenizarConSdk,
  tokenizar,
  camposSdk,
  MENSAJE_TOKEN,
  type EntornoSdk,
  type SdkDecidir,
} from "./payway-token";
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


/* ───────────────────────── SDK oficial (decidir.js) ───────────────────────── */

type Handler = (status: number, respuesta: unknown) => void;

function entornoFalso(opts: { respuesta?: [number, unknown]; sinSdk?: boolean; lanza?: boolean } = {}) {
  const desmontar = vi.fn();
  const montados: Array<Record<string, string>> = [];
  const instancias: Array<{ url: string; inhabilitarCS?: boolean; key?: string; timeout?: number }> = [];
  let formVisto: unknown;
  class Decidir implements SdkDecidir {
    datos: { url: string; inhabilitarCS?: boolean; key?: string; timeout?: number };
    constructor(url: string, inhabilitarCS?: boolean) {
      this.datos = { url, inhabilitarCS };
      instancias.push(this.datos);
    }
    setPublishableKey(k: string) {
      this.datos.key = k;
    }
    setTimeout(ms: number) {
      this.datos.timeout = ms;
    }
    createToken(form: unknown, cb: Handler) {
      formVisto = form;
      if (opts.lanza) throw new Error("boom");
      const [st, resp] = opts.respuesta ?? [201, { id: TOKEN_OK.id, bin: "450799" }];
      cb(st, resp);
    }
    getBin(pan: string) {
      return pan.slice(0, 6);
    }
  }
  const entorno: EntornoSdk = {
    cargarSdk: async () => (opts.sinSdk ? null : (Decidir as never)),
    montarFormulario: (campos) => {
      montados.push(campos);
      return { form: { campos }, desmontar };
    },
  };
  return { entorno, desmontar, montados, instancias, formVisto: () => formVisto };
}

describe("camposSdk", () => {
  it("traduce la solicitud a los data-decidir del SDK", () => {
    expect(camposSdk(SOLICITUD)).toEqual({
      card_number: "4507990000004905",
      security_code: "123",
      card_holder_name: "Juan Perez",
      card_expiration_month: "08",
      card_expiration_year: "30",
      card_holder_doc_type: "dni",
      card_holder_doc_number: "25123456",
    });
  });
});

describe("tokenizarConSdk", () => {
  it("usa el SDK con la key pública y la URL /api/v2, sin Cybersource, y devuelve token y bin", async () => {
    const e = entornoFalso();
    const r = await tokenizarConSdk(SOLICITUD, CONFIG, e.entorno);
    expect(r).toEqual({ ok: true, token: TOKEN_OK.id, bin: "450799" });
    expect(e.instancias[0]).toMatchObject({
      url: "https://payway.example/api/v2",
      inhabilitarCS: true,
      key: "clave-publica-de-prueba",
    });
    expect(e.montados[0]?.card_number).toBe("4507990000004905");
  });

  it("desmonta el formulario con los datos de la tarjeta siempre, también si falla o lanza", async () => {
    for (const opts of [{}, { respuesta: [400, {}] as [number, unknown] }, { lanza: true }]) {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const e = entornoFalso(opts);
      await tokenizarConSdk(SOLICITUD, CONFIG, e.entorno);
      expect(e.desmontar).toHaveBeenCalledTimes(1);
    }
  });

  it("si la respuesta no trae bin lo toma de los 6 primeros dígitos", async () => {
    const e = entornoFalso({ respuesta: [201, { id: TOKEN_OK.id }] });
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, e.entorno)).toEqual({ ok: true, token: TOKEN_OK.id, bin: "450799" });
  });

  it("errores de validación del SDK (response.error) y 400 -> datos_invalidos", async () => {
    for (const respuesta of [
      [0, { error: [{ isValid: false, error: { type: "invalid_card_number" }, param: "card_number" }] }],
      [400, { error_type: "invalid_request_error" }],
    ] as Array<[number, unknown]>) {
      const e = entornoFalso({ respuesta });
      expect(await tokenizarConSdk(SOLICITUD, CONFIG, e.entorno)).toMatchObject({ ok: false, motivo: "datos_invalidos" });
    }
  });

  it("401/403 -> configuracion; otros estados (0, 5xx) -> red", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, entornoFalso({ respuesta: [401, {}] }).entorno)).toMatchObject({ motivo: "configuracion" });
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, entornoFalso({ respuesta: [403, {}] }).entorno)).toMatchObject({ motivo: "configuracion" });
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, entornoFalso({ respuesta: [0, {}] }).entorno)).toMatchObject({ motivo: "red" });
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, entornoFalso({ respuesta: [503, {}] }).entorno)).toMatchObject({ motivo: "red" });
  });

  it("éxito sin id utilizable -> configuracion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const e = entornoFalso({ respuesta: [201, {}] });
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, e.entorno)).toMatchObject({ ok: false, motivo: "configuracion" });
  });

  it("devuelve null si el SDK no se pudo cargar", async () => {
    const e = entornoFalso({ sinSdk: true });
    expect(await tokenizarConSdk(SOLICITUD, CONFIG, e.entorno)).toBeNull();
  });

  it("no loguea datos de la tarjeta", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await tokenizarConSdk(SOLICITUD, CONFIG, entornoFalso({ lanza: true }).entorno);
    await tokenizarConSdk(SOLICITUD, CONFIG, entornoFalso({ respuesta: [401, { id: "x" }] }).entorno);
    const t = JSON.stringify(log.mock.calls);
    expect(t).not.toContain("4507990000004905");
    expect(t).not.toContain("clave-publica-de-prueba");
  });
});

describe("tokenizar (SDK primero, fetch directo de respaldo)", () => {
  it("con el SDK disponible no usa el fetch directo", async () => {
    const f = vi.fn();
    const e = entornoFalso();
    const r = await tokenizar(SOLICITUD, CONFIG, { entorno: e.entorno, fetch: f });
    expect(r.ok).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("si el SDK no carga (bloqueado, sin red) cae al fetch directo a /tokens", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(201, TOKEN_OK));
    const e = entornoFalso({ sinSdk: true });
    const r = await tokenizar(SOLICITUD, CONFIG, { entorno: e.entorno, fetch: f });
    expect(r).toEqual({ ok: true, token: TOKEN_OK.id, bin: "450799" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sin entorno de SDK (servidor, tests) usa el fetch directo", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(201, TOKEN_OK));
    expect((await tokenizar(SOLICITUD, CONFIG, { fetch: f })).ok).toBe(true);
  });

  it("si el fetch de respaldo también falla: mensaje en usted y sin cobro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await tokenizar(SOLICITUD, CONFIG, { entorno: entornoFalso({ sinSdk: true }).entorno, fetch: f });
    expect(r).toEqual({ ok: false, motivo: "red", mensaje: MENSAJE_TOKEN.red });
  });
});
