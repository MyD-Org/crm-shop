import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { cuotasHabilitadas } from "./cuotas-flag";

/** Lee el flag `cuotas` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("cuotasHabilitadas", () => {
  it("apagado por defecto", async () => {
    expect(await cuotasHabilitadas()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("cuotas", true);
    expect(await cuotasHabilitadas()).toBe(true);
  });
});
