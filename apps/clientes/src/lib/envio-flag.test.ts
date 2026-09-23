import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { envioHabilitado } from "./envio-flag";

/** Lee el flag `envio` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("envioHabilitado", () => {
  it("apagado por defecto", async () => {
    expect(await envioHabilitado()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("envio", true);
    expect(await envioHabilitado()).toBe(true);
  });
});
