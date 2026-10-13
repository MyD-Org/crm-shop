import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS_HOME } from "@/data/home-defaults";

const { whereMock, fromMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
  fromMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: () => ({ select: () => ({ from: fromMock }) }) }));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

import { getContenidoHome } from "./home-datos";

describe("getContenidoHome (shell cacheado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
    fromMock.mockReturnValue({ where: whereMock });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("con la base: tag home y vida larga", async () => {
    whereMock.mockResolvedValue([{ key: "anuncio", payload: { texto: "Hola" } }]);
    const out = await getContenidoHome();
    expect(out.anuncio.texto).toBe("Hola");
    expect(cacheTagMock).toHaveBeenCalledWith("home");
    expect(cacheLifeMock).toHaveBeenCalledWith("home");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("base caída: defaults con el perfil degradado, nunca la vida de la home", async () => {
    whereMock.mockRejectedValue(new Error("sin conexión"));
    expect(await getContenidoHome()).toEqual(DEFAULTS_HOME);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("home");
  });
});
