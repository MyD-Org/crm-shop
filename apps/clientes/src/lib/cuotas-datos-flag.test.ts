import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Gate de exhibición (spec 8 "Flag apagado"): con CUOTAS_ENABLED apagado,
 * card, ficha, carrito y checkout reciben oferta null SIN tocar la DB. Con el
 * flag prendido y la DB caída, también null (las páginas renderizan sin cuotas).
 */
const leerConfig = vi.fn();
const leerPlanes = vi.fn();

vi.mock("./cuotas-repo", () => ({ repoCuotasDrizzle: { leerConfig, leerPlanes } }));
vi.mock("next/server", () => ({ after: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  leerConfig.mockReset();
  leerPlanes.mockReset();
});

describe("getOfertaCuotas", () => {
  it("flag apagado → null sin leer la DB", async () => {
    vi.stubEnv("CUOTAS_ENABLED", "");
    const { getOfertaCuotas } = await import("./cuotas-datos");
    expect(await getOfertaCuotas()).toBeNull();
    expect(leerConfig).not.toHaveBeenCalled();
  });

  it("flag prendido y DB que tira → null, sin propagar", async () => {
    vi.stubEnv("CUOTAS_ENABLED", "1");
    vi.stubEnv("SHOP_TENANT_ID", "central-led");
    vi.spyOn(console, "error").mockImplementation(() => {});
    leerConfig.mockRejectedValue(new Error("db caída"));
    const { getOfertaCuotas } = await import("./cuotas-datos");
    await expect(getOfertaCuotas()).resolves.toBeNull();
    expect(leerConfig).toHaveBeenCalled();
  });
});
