import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/tema-contrato.json";

// Prueba la lectura real: el mock global de setup-flags.ts devuelve el tema de Central.
vi.unmock("@/lib/tema-tenant-datos");

const { limitMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) }),
}));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

import { getTemaTenant } from "./tema-tenant-datos";

describe("getTemaTenant (caché del tema)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("con paleta propia: la devuelve, con el tag marca y la vida del perfil marca", async () => {
    limitMock.mockResolvedValue([{ shopTema: { colores: fixture.paletas["calido-azul"] } }]);
    const t = await getTemaTenant();
    expect(t.colores).toEqual(fixture.paletas["calido-azul"]);
    expect(cacheTagMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("tema vacío o sin fila: el de Central, sin paleta propia", async () => {
    limitMock.mockResolvedValue([{ shopTema: {} }]);
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
    limitMock.mockResolvedValue([]);
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
  });

  it("la columna todavía no existe (o la base cae): no lanza y usa el perfil degradado", async () => {
    limitMock.mockRejectedValue(new Error('column "shop_tema" does not exist'));
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("marca");
  });

  it("sin SHOP_TENANT_ID tampoco lanza", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    limitMock.mockResolvedValue([]);
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
  });
});
