import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ivaDeItem, ivaPersistible, listAllCategories, mapItemRow } from "./alegra";

/**
 * El IVA que se guarda en el espejo es el que después se muestra como "precio
 * final". Por eso NO puede caer a `IVA_DEFAULT` como hace `ivaDeItem`: cobrar
 * 21% de más en el checkout se corrige a mano, pero publicar un precio final
 * inventado es una promesa al cliente. Si Alegra no manda `tax`, se guarda null
 * y la exhibición muestra el precio como hasta ahora.
 */
describe("ivaPersistible", () => {
  it("devuelve la alícuota del ítem", () => {
    expect(ivaPersistible({ tax: [{ percentage: "21.00" }] })).toBe(21);
    expect(ivaPersistible({ tax: [{ percentage: 10.5 }] })).toBe(10.5);
  });

  it("suma los impuestos del ítem, igual que la cotización", () => {
    expect(ivaPersistible({ tax: [{ percentage: 21 }, { percentage: "2.5" }] })).toBe(23.5);
  });

  it("respeta un ítem exento (0%) como dato válido", () => {
    expect(ivaPersistible({ tax: [{ percentage: 0 }] })).toBe(0);
  });

  it("devuelve null si Alegra no manda tax, sin caer al default", () => {
    expect(ivaPersistible({})).toBeNull();
    expect(ivaPersistible({ tax: [] })).toBeNull();
    // Contraste: la cotización sí cae al default.
    expect(ivaDeItem({})).toBe(21);
  });

  it("devuelve null si ningún porcentaje es numérico", () => {
    expect(ivaPersistible({ tax: [{ percentage: "abc" }, { name: "IVA" }] })).toBeNull();
  });
});

describe("mapItemRow", () => {
  const base = {
    id: 7,
    name: "Lámpara",
    status: "active",
    price: [{ idPriceList: 1, name: "General", price: 100000, main: true }],
  };

  it("expone ivaPorcentaje sin tocar los precios de lista", () => {
    const fila = mapItemRow({ ...base, tax: [{ percentage: "21.00" }] });
    expect(fila.ivaPorcentaje).toBe(21);
    expect(fila.prices).toEqual([
      { idPriceList: "1", name: "General", price: 100000, main: true },
    ]);
  });

  it("ivaPorcentaje null si el ítem no tiene tax", () => {
    expect(mapItemRow(base).ivaPorcentaje).toBeNull();
  });
});

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
