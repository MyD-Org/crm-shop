import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileConfigurado, verificarTurnstile } from "./turnstile";

const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("TURNSTILE_SECRET_KEY", "clave-turnstile-de-prueba");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verificarTurnstile", () => {
  it("éxito explícito => ok, y manda secreto, token y remoteip a siteverify", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ success: true }));
    expect(await verificarTurnstile("tok", "203.0.113.9", f)).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const cuerpo = init.body as URLSearchParams;
    expect(cuerpo.get("secret")).toBe("clave-turnstile-de-prueba");
    expect(cuerpo.get("response")).toBe("tok");
    expect(cuerpo.get("remoteip")).toBe("203.0.113.9");
  });

  it("sin IP no manda remoteip", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ success: true }));
    await verificarTurnstile("tok", null, f);
    expect((f.mock.calls[0][1].body as URLSearchParams).has("remoteip")).toBe(false);
  });

  it("falla cerrada: sin secreto no consulta nada", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const f = vi.fn();
    expect(turnstileConfigurado()).toBe(false);
    expect(await verificarTurnstile("tok", null, f)).toEqual({ ok: false, motivo: "no_configurado" });
    expect(f).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", 123, "x".repeat(3000)])("falla cerrada: token %j", async (token) => {
    const f = vi.fn();
    expect(await verificarTurnstile(token, null, f)).toEqual({ ok: false, motivo: "sin_token" });
    expect(f).not.toHaveBeenCalled();
  });

  it("success false => rechazado", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await verificarTurnstile("tok", null, f)).toEqual({ ok: false, motivo: "rechazado" });
  });

  it.each([{}, { success: "true" }, { success: 1 }, []])("falla cerrada: respuesta rara %j", async (cuerpo) => {
    const f = vi.fn().mockResolvedValue(respuesta(cuerpo));
    expect((await verificarTurnstile("tok", null, f)).ok).toBe(false);
  });

  it("falla cerrada: HTTP no ok", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ success: true }, 500));
    expect(await verificarTurnstile("tok", null, f)).toEqual({ ok: false, motivo: "error_red" });
  });

  it("falla cerrada: red caída o timeout", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await verificarTurnstile("tok", null, f)).toEqual({ ok: false, motivo: "error_red" });
  });

  it("no filtra el secreto ni el token a los logs", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"));
    await verificarTurnstile("tok-del-usuario", null, f);
    const logs = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logs).not.toContain("clave-turnstile-de-prueba");
    expect(logs).not.toContain("tok-del-usuario");
  });
});
