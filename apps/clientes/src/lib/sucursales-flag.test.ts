import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { sucursalesHabilitadas } from "./sucursales-flag";

/** Lee el flag `sucursales` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("sucursalesHabilitadas", () => {
  it("apagado por defecto", async () => {
    expect(await sucursalesHabilitadas()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("sucursales", true);
    expect(await sucursalesHabilitadas()).toBe(true);
  });
});
