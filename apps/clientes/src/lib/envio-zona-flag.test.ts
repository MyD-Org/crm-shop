import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { envioPorZonaHabilitado } from "./envio-zona-flag";

/** Lee el flag `envio-por-zona` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("envioPorZonaHabilitado", () => {
  it("apagado por defecto", async () => {
    expect(await envioPorZonaHabilitado()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("envio-por-zona", true);
    expect(await envioPorZonaHabilitado()).toBe(true);
  });
});
