import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const { permitirAsync, contarPendientesInvitado, verificarTurnstile, turnstileConfigurado } = vi.hoisted(() => ({
  permitirAsync: vi.fn(),
  contarPendientesInvitado: vi.fn(),
  verificarTurnstile: vi.fn(),
  turnstileConfigurado: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/pedidos", () => ({
  contarPendientesInvitado,
  formatearNumero: (n: number) => `PED-${String(n).padStart(8, "0")}`,
}));
vi.mock("@/lib/turnstile", () => ({ verificarTurnstile, turnstileConfigurado }));

import { CAMPO_TRAMPA } from "./arrepentimiento";
import {
  MAX_PEDIDOS_INVITADO_POR_DIA_IP,
  MAX_PEDIDOS_INVITADO_POR_MINUTO_IP,
  MAX_PENDIENTES_POR_EMAIL,
  guardarCompraInvitado,
  normalizarEmail,
  origenDelMismoSitio,
} from "./invitado-guarda";
import { MENSAJES_INVITADO } from "./invitado-mensajes";

const URL_PEDIDOS = "https://shop.example/api/pedidos";

function cuerpoValido(extra: Record<string, unknown> = {}) {
  return {
    email: "Ana@Cliente.example ",
    emailConfirmacion: "ana@cliente.example",
    turnstile: "tok",
    iniciado: String(Date.now() - 20_000),
    ...extra,
  };
}

function peticion(
  cuerpo: unknown,
  headers: Record<string, string> = {},
  { json = true }: { json?: boolean } = {},
): Request {
  return new Request(URL_PEDIDOS, {
    method: "POST",
    headers: {
      origin: "https://shop.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.5",
      ...(json ? { "content-type": "application/json" } : { "content-type": "text/plain" }),
      ...headers,
    },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
  setFlag("compra-invitado", true);
  permitirAsync.mockReset().mockResolvedValue(true);
  contarPendientesInvitado.mockReset().mockResolvedValue(0);
  verificarTurnstile.mockReset().mockResolvedValue({ ok: true });
  turnstileConfigurado.mockReset().mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function cuerpoDe(r: { ok: false; respuesta: Response }) {
  return { status: r.respuesta.status, json: await r.respuesta.json() };
}

describe("normalizarEmail", () => {
  it("trim y minúsculas; inválidos => null", () => {
    expect(normalizarEmail("  Ana@Cliente.example ")).toBe("ana@cliente.example");
    for (const v of ["", "ana", "ana@", "a b@c.example", 5, null, undefined, `${"a".repeat(250)}@c.example`]) {
      expect(normalizarEmail(v)).toBeNull();
    }
  });
});

describe("origenDelMismoSitio", () => {
  it("Sec-Fetch-Site manda cuando está", () => {
    expect(origenDelMismoSitio(peticion({}, { "sec-fetch-site": "same-origin" }))).toBe(true);
    for (const sitio of ["cross-site", "same-site", "none"]) {
      expect(origenDelMismoSitio(peticion({}, { "sec-fetch-site": sitio })), sitio).toBe(false);
    }
  });
  it("sin Sec-Fetch-Site se compara Origin con el sitio; sin ninguno, no", () => {
    const sin = (h: Record<string, string>) =>
      new Request(URL_PEDIDOS, { method: "POST", headers: h, body: "{}" });
    expect(origenDelMismoSitio(sin({ origin: "https://shop.example" }))).toBe(true);
    expect(origenDelMismoSitio(sin({ origin: "https://otro.example" }))).toBe(false);
    expect(origenDelMismoSitio(sin({ origin: "no es una url" }))).toBe(false);
    expect(origenDelMismoSitio(sin({}))).toBe(false);
  });
});

describe("guardarCompraInvitado", () => {
  it("camino feliz: devuelve el cuerpo, el email normalizado y la IP", async () => {
    const r = await guardarCompraInvitado(peticion(cuerpoValido()));
    expect(r).toMatchObject({ ok: true, email: "ana@cliente.example", ip: "203.0.113.5" });
  });

  it("flag apagado => 401 idéntico al de hoy, sin leer el cuerpo ni consultar nada", async () => {
    setFlag("compra-invitado", false);
    const req = peticion(cuerpoValido());
    const r = await guardarCompraInvitado(req);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(await cuerpoDe(r)).toEqual({ status: 401, json: { error: "No autorizado" } });
    expect(req.bodyUsed).toBe(false);
    expect(permitirAsync).not.toHaveBeenCalled();
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });

  it("falla cerrada: sin Turnstile configurado => 503 en usted y no se crea nada", async () => {
    turnstileConfigurado.mockReturnValue(false);
    const r = await guardarCompraInvitado(peticion(cuerpoValido()));
    if (r.ok) throw new Error("ok");
    expect(await cuerpoDe(r)).toEqual({
      status: 503,
      json: { error: MENSAJES_INVITADO.noDisponible, motivo: "invitado_no_disponible" },
    });
  });

  it("falla cerrada: sin el secreto del pedido (no se puede firmar el token) => 503", async () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "");
    const r = await guardarCompraInvitado(peticion(cuerpoValido()));
    if (r.ok) throw new Error("ok");
    expect(r.respuesta.status).toBe(503);
  });

  it("origen cruzado => 403", async () => {
    const r = await guardarCompraInvitado(peticion(cuerpoValido(), { "sec-fetch-site": "cross-site", origin: "https://malo.example" }));
    if (r.ok) throw new Error("ok");
    expect(r.respuesta.status).toBe(403);
    expect(permitirAsync).not.toHaveBeenCalled();
  });

  it("Content-Type que no es JSON => 403", async () => {
    const r = await guardarCompraInvitado(peticion(JSON.stringify(cuerpoValido()), {}, { json: false }));
    if (r.ok) throw new Error("ok");
    expect(r.respuesta.status).toBe(403);
  });

  it("cuerpo que no es JSON o no es un objeto => 400", async () => {
    for (const cuerpo of ["{no", "[]", "null", '"x"']) {
      const r = await guardarCompraInvitado(peticion(cuerpo));
      if (r.ok) throw new Error("ok");
      expect(r.respuesta.status, cuerpo).toBe(400);
    }
  });

  it("honeypot lleno => 201 FALSO con la forma de un pedido, sin Turnstile ni cuenta del tope", async () => {
    const r = await guardarCompraInvitado(peticion(cuerpoValido({ [CAMPO_TRAMPA]: "http://spam.example" })));
    if (r.ok) throw new Error("ok");
    const { status, json } = await cuerpoDe(r);
    expect(status).toBe(201);
    expect(json).toMatchObject({ repetido: false, cuotas: null, cuentaPago: null });
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.invitadoToken).toBeUndefined();
    expect(verificarTurnstile).not.toHaveBeenCalled();
    expect(contarPendientesInvitado).not.toHaveBeenCalled();
  });

  it.each([
    ["demasiado rápido", () => String(Date.now() - 500)],
    ["ausente", () => undefined],
    ["vencido (más de un día)", () => String(Date.now() - 2 * 24 * 60 * 60_000)],
    ["basura", () => "ayer"],
  ])("llenado %s => 201 falso", async (_n, iniciado) => {
    const r = await guardarCompraInvitado(peticion(cuerpoValido({ iniciado: iniciado() })));
    if (r.ok) throw new Error("ok");
    expect(r.respuesta.status).toBe(201);
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });

  it("acepta `iniciado` como número", async () => {
    const r = await guardarCompraInvitado(peticion(cuerpoValido({ iniciado: Date.now() - 20_000 })));
    expect(r.ok).toBe(true);
  });

  it("tope por IP: 5 por minuto y 10 por día, contador por IP (no por cookie ni token)", async () => {
    await guardarCompraInvitado(peticion(cuerpoValido(), { "x-forwarded-for": "198.51.100.77" }));
    expect(permitirAsync.mock.calls).toEqual([
      ["pedidos-inv:ip:198.51.100.77:min", MAX_PEDIDOS_INVITADO_POR_MINUTO_IP, 60_000],
      ["pedidos-inv:ip:198.51.100.77:dia", MAX_PEDIDOS_INVITADO_POR_DIA_IP, 86_400_000],
    ]);
    expect([MAX_PEDIDOS_INVITADO_POR_MINUTO_IP, MAX_PEDIDOS_INVITADO_POR_DIA_IP]).toEqual([5, 10]);
  });

  it.each([0, 1])("excede el tope (contador %i) => 429 en usted con Retry-After", async (cual) => {
    permitirAsync.mockReset();
    permitirAsync.mockImplementation(async () => true);
    permitirAsync.mockResolvedValueOnce(cual !== 0).mockResolvedValueOnce(cual !== 1);
    const r = await guardarCompraInvitado(peticion(cuerpoValido()));
    if (r.ok) throw new Error("ok");
    expect(await cuerpoDe(r)).toEqual({ status: 429, json: { error: MENSAJES_INVITADO.demasiadosIntentos } });
    expect(r.respuesta.headers.get("Retry-After")).toBe("60");
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });

  it("emails distintos => 400 en usted; email inválido => 400", async () => {
    const distintos = await guardarCompraInvitado(peticion(cuerpoValido({ emailConfirmacion: "otra@cliente.example" })));
    if (distintos.ok) throw new Error("ok");
    expect(await cuerpoDe(distintos)).toMatchObject({ status: 400, json: { error: "Los correos electrónicos no coinciden." } });

    const invalido = await guardarCompraInvitado(peticion(cuerpoValido({ email: "ana", emailConfirmacion: "ana" })));
    if (invalido.ok) throw new Error("ok");
    expect(await cuerpoDe(invalido)).toMatchObject({ status: 400, json: { campo: "email" } });

    const sinConfirmar = await guardarCompraInvitado(peticion(cuerpoValido({ emailConfirmacion: undefined })));
    expect(sinConfirmar.ok).toBe(false);
  });

  it("emails iguales tras normalizar (mayúsculas y espacios) => pasa", async () => {
    const r = await guardarCompraInvitado(peticion(cuerpoValido({ email: "  ANA@cliente.example", emailConfirmacion: "ana@Cliente.example " })));
    expect(r.ok).toBe(true);
  });

  it("Turnstile ausente o rechazado => 400 con el texto de la spec, sin tope ni pedido", async () => {
    verificarTurnstile.mockResolvedValue({ ok: false, motivo: "rechazado" });
    const r = await guardarCompraInvitado(peticion(cuerpoValido()));
    if (r.ok) throw new Error("ok");
    expect(await cuerpoDe(r)).toEqual({
      status: 400,
      json: { error: "No pudimos verificar la solicitud. Inténtelo nuevamente.", motivo: "verificacion_fallida" },
    });
    expect(contarPendientesInvitado).not.toHaveBeenCalled();
  });

  it("Turnstile se verifica con el token del cuerpo y la IP", async () => {
    await guardarCompraInvitado(peticion(cuerpoValido({ turnstile: "token-del-widget" })));
    expect(verificarTurnstile).toHaveBeenCalledWith("token-del-widget", "203.0.113.5");
  });

  it("tope de pendientes por email: 3 en 24 h => 409 pendientes_tope en usted", async () => {
    contarPendientesInvitado.mockResolvedValue(MAX_PENDIENTES_POR_EMAIL);
    const r = await guardarCompraInvitado(peticion(cuerpoValido()));
    if (r.ok) throw new Error("ok");
    expect(await cuerpoDe(r)).toEqual({
      status: 409,
      json: { error: MENSAJES_INVITADO.pendientesTope, motivo: "pendientes_tope" },
    });
    expect(contarPendientesInvitado.mock.calls[0][0]).toBe("ana@cliente.example");
  });

  it("2 pendientes todavía pasa", async () => {
    contarPendientesInvitado.mockResolvedValue(MAX_PENDIENTES_POR_EMAIL - 1);
    expect((await guardarCompraInvitado(peticion(cuerpoValido()))).ok).toBe(true);
  });

  it("el atajo idempotente corta ANTES de Turnstile y del tope (su token es de un solo uso)", async () => {
    const atajo = vi.fn().mockResolvedValue(Response.json({ repetido: true }, { status: 200 }));
    const r = await guardarCompraInvitado(peticion(cuerpoValido()), { atajo });
    if (r.ok) throw new Error("ok");
    expect(r.respuesta.status).toBe(200);
    expect(atajo).toHaveBeenCalledWith({ body: expect.objectContaining({ turnstile: "tok" }), email: "ana@cliente.example" });
    expect(verificarTurnstile).not.toHaveBeenCalled();
    expect(contarPendientesInvitado).not.toHaveBeenCalled();
  });

  it("el atajo que no encuentra nada deja seguir", async () => {
    const atajo = vi.fn().mockResolvedValue(null);
    expect((await guardarCompraInvitado(peticion(cuerpoValido()), { atajo })).ok).toBe(true);
    expect(verificarTurnstile).toHaveBeenCalled();
  });

  it("los mensajes no filtran el email ni la IP a los logs", async () => {
    verificarTurnstile.mockResolvedValue({ ok: false, motivo: "error_red" });
    await guardarCompraInvitado(peticion(cuerpoValido()));
    const logs = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logs).not.toContain("cliente.example");
    expect(logs).not.toContain("203.0.113.5");
  });
});
