import { afterEach, describe, expect, it, vi } from "vitest";
import { cuotasHabilitadas } from "./cuotas-flag";

describe("cuotasHabilitadas", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagado por defecto", () => {
    vi.stubEnv("CUOTAS_ENABLED", undefined as unknown as string);
    expect(cuotasHabilitadas()).toBe(false);
  });

  it("sólo '1' lo enciende", () => {
    vi.stubEnv("CUOTAS_ENABLED", "1");
    expect(cuotasHabilitadas()).toBe(true);
    for (const v of ["0", "true", "yes", ""]) {
      vi.stubEnv("CUOTAS_ENABLED", v);
      expect(cuotasHabilitadas()).toBe(false);
    }
  });
});
