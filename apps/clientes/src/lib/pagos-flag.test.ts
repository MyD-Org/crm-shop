import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { pagosHabilitados } from "./pagos-flag";

/** Lee el flag `pagos` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("pagosHabilitados", () => {
  it("apagado por defecto", async () => {
    expect(await pagosHabilitados()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("pagos", true);
    expect(await pagosHabilitados()).toBe(true);
  });
});
