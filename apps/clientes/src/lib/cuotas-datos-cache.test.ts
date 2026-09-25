import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import valido from "./__fixtures__/cuotas-contrato-v2/valido.json";
import { setFlag } from "@/test/flags";

/**
 * Oferta de cuotas para exhibir, cacheada (`'use cache: remote'`, tag
 * `cuotas`). Lo que importa: el tag y el perfil correctos, que una oferta
 * faltante o vieja no se guarde por horas, y que la sync lazy (`after`) se
 * programe AFUERA del scope cacheado — también cuando la respuesta sale de la
 * caché. La del pedido no pasa por la caché.
 */
const { leerConfig, leerPlanes, afterMock, cacheTagMock, cacheLifeMock } = vi.hoisted(() => ({
  leerConfig: vi.fn(),
  leerPlanes: vi.fn(),
  afterMock: vi.fn(),
  cacheTagMock: vi.fn(),
  cacheLifeMock: vi.fn(),
}));

vi.mock("./cuotas-repo", () => ({ repoCuotasDrizzle: { leerConfig, leerPlanes } }));
vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("next/cache", () => ({ cacheTag: cacheTagMock, cacheLife: cacheLifeMock }));

import { getOfertaCuotasParaPedido, ofertaCuotasCacheada } from "./cuotas-datos";

const reciente = () => new Date(Date.now() - 60_000);
const vieja = () => new Date(Date.now() - 13 * 3600_000);
const planesFrescos = () => [
  {
    proveedor: "mercadopago",
    medio: "visa",
    planes: [{ proveedor: "mercadopago", medio: "visa", cuotas: 3, tasaPct: 0, cftPct: null, teaPct: null, montoMin: null, montoMax: null }],
    fetchedAt: reciente(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ofertaCuotasCacheada", () => {
  it("copia fresca: tag cuotas y perfil cuotas, sin pedir sync", async () => {
    leerConfig.mockResolvedValue({ payload: valido, fetchedAt: reciente() });
    leerPlanes.mockResolvedValue(planesFrescos());
    const r = await ofertaCuotasCacheada();
    expect(r.oferta).not.toBeNull();
    expect(r.requiereSync).toBe(false);
    expect(cacheTagMock).toHaveBeenCalledWith("cuotas");
    expect(cacheLifeMock).toHaveBeenCalledWith("cuotas");
    // Nunca programa nada desde adentro de la caché.
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("copia vieja: devuelve la oferta, pide sync y se guarda con el perfil degradado", async () => {
    leerConfig.mockResolvedValue({ payload: valido, fetchedAt: vieja() });
    leerPlanes.mockResolvedValue(planesFrescos());
    const r = await ofertaCuotasCacheada();
    expect(r.oferta).not.toBeNull();
    expect(r.requiereSync).toBe(true);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("cuotas");
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("base caída: null con el perfil degradado", async () => {
    leerConfig.mockRejectedValue(new Error("db caída"));
    const r = await ofertaCuotasCacheada();
    expect(r.oferta).toBeNull();
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
  });
});

describe("getOfertaCuotas (exhibir)", () => {
  it("con copia vieja programa la sync lazy afuera de la caché", async () => {
    setFlag("cuotas", true);
    leerConfig.mockResolvedValue({ payload: valido, fetchedAt: vieja() });
    leerPlanes.mockResolvedValue(planesFrescos());
    vi.resetModules();
    const { getOfertaCuotas } = await import("./cuotas-datos");
    expect(await getOfertaCuotas()).not.toBeNull();
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});

describe("getOfertaCuotasParaPedido", () => {
  it("no pasa por la caché: congela lo que hay en la base en ese momento", async () => {
    leerConfig.mockResolvedValue({ payload: valido, fetchedAt: reciente() });
    leerPlanes.mockResolvedValue(planesFrescos());
    expect(await getOfertaCuotasParaPedido()).not.toBeNull();
    expect(cacheTagMock).not.toHaveBeenCalled();
    expect(cacheLifeMock).not.toHaveBeenCalled();
  });
});
