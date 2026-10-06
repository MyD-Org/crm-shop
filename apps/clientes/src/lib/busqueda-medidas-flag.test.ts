import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { busquedaMedidasHabilitada } from "./busqueda-medidas-flag";

/** Lee el flag `busqueda-medidas` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("busquedaMedidasHabilitada", () => {
  it("apagado por defecto", async () => {
    expect(await busquedaMedidasHabilitada()).toBe(false);
  });

  it("prendido desde Vercel Flags", async () => {
    setFlag("busqueda-medidas", true);
    expect(await busquedaMedidasHabilitada()).toBe(true);
  });

  it("si el flag no se puede evaluar, asume apagado", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      busquedaMedidasFlag: async () => {
        throw new Error("sin red");
      },
    }));
    const { busquedaMedidasHabilitada: aislada } = await import("./busqueda-medidas-flag");
    expect(await aislada()).toBe(false);
    vi.doUnmock("@/flags");
  });

  it("sólo el valor true prende el flag", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({ busquedaMedidasFlag: async () => "si" }));
    const { busquedaMedidasHabilitada: aislada } = await import("./busqueda-medidas-flag");
    expect(await aislada()).toBe(false);
    vi.doUnmock("@/flags");
  });
});
