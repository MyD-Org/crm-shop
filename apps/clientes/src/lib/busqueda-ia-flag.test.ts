import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { busquedaIaHabilitada } from "./busqueda-ia-flag";

/** Lee el flag `busqueda-ia` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("busquedaIaHabilitada", () => {
  it("apagado por defecto", async () => {
    expect(await busquedaIaHabilitada()).toBe(false);
  });

  it("prendido", async () => {
    setFlag("busqueda-ia", true);
    expect(await busquedaIaHabilitada()).toBe(true);
  });
});
