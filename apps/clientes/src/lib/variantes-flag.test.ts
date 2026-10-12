import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { variantesSelector } from "./variantes-flag";

/** Lee el flag `variantes-selector` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("variantesSelector", () => {
  it("apagado por defecto", async () => {
    expect(await variantesSelector()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("variantes-selector", true);
    expect(await variantesSelector()).toBe(true);
  });
});
