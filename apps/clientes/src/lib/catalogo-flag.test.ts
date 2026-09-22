import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogoSoloVisibles } from "./catalogo-flag";

describe("catalogoSoloVisibles", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagado por defecto", () => {
    vi.stubEnv("SHOP_CATALOGO_SOLO_VISIBLES", undefined as unknown as string);
    expect(catalogoSoloVisibles()).toBe(false);
  });

  it("sólo '1' lo enciende", () => {
    vi.stubEnv("SHOP_CATALOGO_SOLO_VISIBLES", "1");
    expect(catalogoSoloVisibles()).toBe(true);
    for (const v of ["0", "true", "yes", ""]) {
      vi.stubEnv("SHOP_CATALOGO_SOLO_VISIBLES", v);
      expect(catalogoSoloVisibles()).toBe(false);
    }
  });
});
