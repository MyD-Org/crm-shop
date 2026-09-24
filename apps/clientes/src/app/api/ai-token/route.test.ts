import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

/**
 * POST /api/ai-token (CHAT-1, CHAT-3): con el flag apagado 404 sin tocar nada;
 * vinculado ⇒ sesión con crm_token; sin vínculo o anónimo ⇒ visitante sin
 * claims. La API key y el secreto nunca vuelven al navegador.
 */

const identidad = vi.fn();
const permitir = vi.fn();
const cookieGet = vi.fn();
const cookieSet = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => cookieGet(n), set: (...a: unknown[]) => cookieSet(...a) }),
}));

import { POST } from "./route";

const SECRETO = "secreto-de-prueba-de-al-menos-32-caracteres";
const UUID_VISITANTE = "0b6f3c1e-8a3d-4c2b-9f1e-2d3c4b5a6f70";
const fetchMock = vi.fn();

const pedir = (headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/ai-token", { method: "POST", headers }));

function cuerpoEnviado(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.stubEnv("AI_API_URL", "https://ai.plataforma.example/");
  vi.stubEnv("AI_API_KEY", "clave-secreta-de-ai-api");
  vi.stubEnv("AI_AGENT_ID", "agente-1");
  vi.stubEnv("SESSION_SECRET", SECRETO);
  vi.stubEnv("SHOP_TENANT_ID", "tienda-demo");
  vi.stubGlobal("fetch", fetchMock);
  identidad.mockReset();
  permitir.mockReset();
  cookieGet.mockReset();
  cookieSet.mockReset();
  fetchMock.mockReset();
  permitir.mockReturnValue(true);
  cookieGet.mockReturnValue(undefined);
  identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
  fetchMock.mockResolvedValue(Response.json({ token: "tok-sesion", end_user_id: "eu-1" }, { status: 201 }));
  setFlag("chat-ia", true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/ai-token", () => {
  it("flag apagado ⇒ 404 sin identidad ni pedido a ai-api", async () => {
    setFlag("chat-ia", false);
    const res = await pedir();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(identidad).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flag prendido pero sin config de ai-api ⇒ 404 sin pedido", async () => {
    vi.stubEnv("AI_API_KEY", "");
    expect((await pedir()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vinculado ⇒ external_id = codigocliente y crm_token del tenant del Shop", async () => {
    identidad.mockResolvedValue({
      clerkUserId: "user_1",
      cliente: { codigocliente: "42", razonsocial: "Cliente Demo SA", origen: "vinculacion" },
    });
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "tok-sesion" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ai.plataforma.example/v1/end-user-sessions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer clave-secreta-de-ai-api");
    const cuerpo = cuerpoEnviado();
    expect(cuerpo.external_id).toBe("42");
    expect(cuerpo.display_name).toBe("Cliente Demo SA");
    const crmToken = (cuerpo.claims as { crm_token: string }).crm_token;
    const payload = JSON.parse(Buffer.from(crmToken.split(".")[0], "base64url").toString());
    expect(payload).toMatchObject({ c: "42", t: "tienda-demo" });
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("logueado sin vínculo ⇒ visitante sin claims, con prefijo propio", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_9", nombre: "Ana", cliente: null });
    expect((await pedir()).status).toBe(200);
    expect(cuerpoEnviado()).toEqual({ external_id: "shop-clerk:user_9", display_name: "Ana" });
  });

  it("anónimo nuevo ⇒ visitante sin claims y cookie httpOnly con un UUID", async () => {
    expect((await pedir({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).status).toBe(200);
    const cuerpo = cuerpoEnviado();
    expect(cuerpo.claims).toBeUndefined();
    expect(cuerpo.external_id).toMatch(/^shop-visitante:[0-9a-f-]{36}$/);
    const [nombre, valor, opciones] = cookieSet.mock.calls[0];
    expect(nombre).toBe("chat_visitante");
    expect(`shop-visitante:${valor}`).toBe(cuerpo.external_id);
    expect(opciones).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(permitir).toHaveBeenCalledWith("ai-token:ip:203.0.113.7", 10, 600_000);
  });

  it("anónimo con cookie válida la reusa; con cookie manipulada crea otra", async () => {
    cookieGet.mockReturnValue({ value: UUID_VISITANTE });
    await pedir();
    expect(cuerpoEnviado().external_id).toBe(`shop-visitante:${UUID_VISITANTE}`);

    fetchMock.mockClear();
    cookieGet.mockReturnValue({ value: "42" });
    await pedir();
    expect(cuerpoEnviado().external_id).not.toBe("shop-visitante:42");
    expect(cuerpoEnviado().external_id).not.toBe("42");
  });

  it("rate limit ⇒ 429 sin pedido a ai-api", async () => {
    permitir.mockReturnValue(false);
    const res = await pedir();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Inténtelo/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ai-api falla ⇒ 502 en usted, sin el cuerpo de ai-api ni la key en logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("detalle interno clave-secreta-de-ai-api", { status: 401 }));
    const res = await pedir();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("El chat no está disponible en este momento. Inténtelo de nuevo más tarde.");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/detalle interno|clave-secreta/);

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await pedir()).status).toBe(502);
    log.mockRestore();
  });

  it("vinculado sin SESSION_SECRET ⇒ 502 sin pedido a ai-api", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "");
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    expect((await pedir()).status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
