import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { catalogoSoloVisibles } from "./catalogo-flag";

/** Lee el flag `catalogo-solo-visibles` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("catalogoSoloVisibles", () => {
  it("apagado por defecto", async () => {
    expect(await catalogoSoloVisibles()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("catalogo-solo-visibles", true);
    expect(await catalogoSoloVisibles()).toBe(true);
  });
});
