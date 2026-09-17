import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAllCategories } from "./alegra";

function respuesta(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("apiFetch ante rate limit (429) de Alegra", () => {
  beforeEach(() => {
    vi.stubEnv("ALEGRA_EMAIL", "test@example.com");
    vi.stubEnv("ALEGRA_TOKEN", "token");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reintenta tras un 429 y completa la paginación", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(429, { message: "Too Many request", code: 429 }))
      .mockImplementation(async () => respuesta(200, []));
    vi.stubGlobal("fetch", fetchMock);

    const promesa = listAllCategories();
    await vi.runAllTimersAsync();

    await expect(promesa).resolves.toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("respeta Retry-After antes de reintentar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(429, {}, { "Retry-After": "7" }))
      .mockImplementation(async () => respuesta(200, []));
    vi.stubGlobal("fetch", fetchMock);

    const promesa = listAllCategories();
    const llamadasIniciales = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(6_900);
    expect(fetchMock.mock.calls.length).toBe(llamadasIniciales);

    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock.mock.calls.length).toBe(llamadasIniciales + 1);

    await vi.runAllTimersAsync();
    await expect(promesa).resolves.toEqual([]);
  });

  it("se rinde si Alegra sigue devolviendo 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => respuesta(429, { message: "Too Many request" }))
    );

    const promesa = listAllCategories();
    const verificacion = expect(promesa).rejects.toThrow(/Alegra 429/);
    await vi.runAllTimersAsync();
    await verificacion;
  });

  it("no reintenta otros errores", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respuesta(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAllCategories()).rejects.toThrow(/Alegra 401/);
    // Una sola tanda de páginas en paralelo, sin reintentos.
    const tanda = fetchMock.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(fetchMock.mock.calls.length).toBe(tanda);
  });
});
