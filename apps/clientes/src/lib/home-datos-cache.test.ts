import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS_HOME } from "@/data/home-defaults";

const { fromMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("con la base: tag home y vida larga", async () => {
    fromMock.mockResolvedValue([{ key: "anuncio", payload: { texto: "Hola" } }]);
    const out = await getContenidoHome();
    expect(out.anuncio.texto).toBe("Hola");
    expect(cacheTagMock).toHaveBeenCalledWith("home");
    expect(cacheLifeMock).toHaveBeenCalledWith("home");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("base caída: defaults con el perfil degradado, nunca la vida de la home", async () => {
    fromMock.mockRejectedValue(new Error("sin conexión"));
    expect(await getContenidoHome()).toEqual(DEFAULTS_HOME);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("home");
  });
});
