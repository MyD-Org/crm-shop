import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  esIdAlegra,
  getContacto,
  getFactura,
  getItem,
  ivaDeItem,
  ivaPersistible,
  listAllCategories,
  mapItemRow,
  tipoCuentaDe,
} from "./alegra";

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

describe("BASE_URL", () => {
  it("ALEGRA_BASE_URL vacía (secret inexistente en Actions) usa el default", async () => {
    vi.stubEnv("ALEGRA_BASE_URL", "");
    vi.stubEnv("ALEGRA_EMAIL", "test@example.com");
    vi.stubEnv("ALEGRA_TOKEN", "token");
    vi.resetModules();
    // Una Response nueva por llamada: el body se consume una sola vez.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { listAllCategories } = await import("./alegra");
    await listAllCategories();
    const [url] = fetchMock.mock.calls[0] as unknown as [RequestInfo];
    expect(String(url)).toMatch(/^https:\/\/api\.alegra\.com\/api\/v1\//);
  });
});

/**
 * Cuenta corriente = el contacto tiene plazo de pago o límite de crédito en Alegra
 * (así lo cargan en la sucursal). Misma regla que el CRM.
 */
describe("tipoCuentaDe", () => {
  it("corriente con plazo de pago o con límite de crédito", () => {
    expect(tipoCuentaDe({ term: { name: "30 días", days: 30 } })).toBe("corriente");
    expect(tipoCuentaDe({ term: { days: "15" } })).toBe("corriente");
    expect(tipoCuentaDe({ creditLimit: 500000 })).toBe("corriente");
    expect(tipoCuentaDe({ term: { name: "Contado", days: 0 }, creditLimit: "100" })).toBe("corriente");
  });

  it("contado sin plazo ni límite (o con plazo Contado = 0 días)", () => {
    expect(tipoCuentaDe({})).toBe("contado");
    expect(tipoCuentaDe(null)).toBe("contado");
    expect(tipoCuentaDe({ term: { name: "Contado", days: 0 }, creditLimit: 0 })).toBe("contado");
    expect(tipoCuentaDe({ term: null, creditLimit: "" })).toBe("contado");
  });
});

/**
 * Los ids llegan del browser y terminan en la ruta de Alegra. `new URL` resuelve
 * los `..`, así que `getItem("../contacts/123")` pegaba a `/contacts/123`.
 */
describe("ids de Alegra en la ruta", () => {
  beforeEach(() => {
    vi.stubEnv("ALEGRA_EMAIL", "test@example.com");
    vi.stubEnv("ALEGRA_TOKEN", "token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("esIdAlegra acepta solo enteros positivos en string", () => {
    expect(esIdAlegra("123")).toBe(true);
    for (const malo of ["", "abc", "../contacts/1", "1/2", "1?x", "-1", "1.5", " 1", 123, null]) {
      expect(esIdAlegra(malo)).toBe(false);
    }
  });

  it.each([
    ["getItem", getItem],
    ["getContacto", getContacto],
    ["getFactura", getFactura],
  ])("%s rechaza un id no numérico sin llamar a Alegra", async (_n, fn) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fn("../contacts/123")).rejects.toThrow(/invalido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getItem arma /items/:id con un id válido", async () => {
    const fetchMock = vi.fn(async () => respuesta(200, { id: "123" }));
    vi.stubGlobal("fetch", fetchMock);
    await getItem("123");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/items\/123$/);
  });
});
