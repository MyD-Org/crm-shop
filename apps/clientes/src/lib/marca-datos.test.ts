import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARCA_POR_DEFECTO } from "./marca-base";

// Prueba la lectura real: el mock global de setup-flags.ts devuelve la marca de Central.
vi.unmock("@/lib/marca");

const { limitMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) }),
}));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

import { getMarca } from "./marca";

describe("getMarca (caché de la marca)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
    vi.stubEnv("SHOP_MEDIA_HOSTS", "media.example");
    vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("con la base: tag marca y vida del perfil marca", async () => {
    limitMock.mockResolvedValue([{ shopMarca: { base: "generica", nombre: "Tienda Uno" } }]);
    const m = await getMarca();
    expect(m.nombre).toBe("Tienda Uno");
    expect(cacheTagMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("marca vacía: la de Central, exacta", async () => {
    limitMock.mockResolvedValue([{ shopMarca: {} }]);
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
  });

  it("sin fila del tenant: la de Central", async () => {
    limitMock.mockResolvedValue([]);
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
  });

  it("la columna todavía no existe (o la base cae): no lanza y usa el perfil degradado", async () => {
    limitMock.mockRejectedValue(new Error('column "shop_marca" does not exist'));
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("marca");
  });

  it("base caída con la variable del nombre: sólo el nombre, nada de Central", async () => {
    vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "Tienda Uno");
    limitMock.mockRejectedValue(new Error("sin conexión"));
    const m = await getMarca();
    expect(m.nombre).toBe("Tienda Uno");
    expect(JSON.stringify(m)).not.toMatch(/central|iguaz/i);
  });

  it("sin SHOP_TENANT_ID tampoco lanza", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
  });
});
