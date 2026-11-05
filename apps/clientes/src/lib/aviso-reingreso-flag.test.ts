import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { avisoReingresoActivo } from "./aviso-reingreso-flag";

describe("avisoReingresoActivo", () => {
  it("apagado por defecto", async () => {
    expect(await avisoReingresoActivo()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("aviso-reingreso", true);
    expect(await avisoReingresoActivo()).toBe(true);
  });

  it("si el flag no se puede evaluar, queda apagado (fail-closed)", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      avisoReingresoFlag: async () => {
        throw new Error("sin conexión con Vercel Flags");
      },
    }));
    const { avisoReingresoActivo: fresco } = await import("./aviso-reingreso-flag");
    expect(await fresco()).toBe(false);
    vi.doUnmock("@/flags");
    vi.resetModules();
  });
});
