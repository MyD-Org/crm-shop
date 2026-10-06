import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { busquedaMotorUnico } from "./busqueda-motor-flag";

describe("busquedaMotorUnico", () => {
  it("apagado por defecto (política legado)", async () => {
    expect(await busquedaMotorUnico()).toBe(false);
  });

  it("prendido desde Vercel Flags", async () => {
    setFlag("busqueda-motor-unico", true);
    expect(await busquedaMotorUnico()).toBe(true);
  });

  it("si el flag no se puede evaluar, asume apagado (legado), sin tirar", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      busquedaMotorUnicoFlag: async () => {
        throw new Error("sin red");
      },
    }));
    const { busquedaMotorUnico: aislada } = await import("./busqueda-motor-flag");
    await expect(aislada()).resolves.toBe(false);
    vi.doUnmock("@/flags");
  });

  it("sólo un `true` explícito prende el motor", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({ busquedaMotorUnicoFlag: async () => undefined }));
    const { busquedaMotorUnico: aislada } = await import("./busqueda-motor-flag");
    expect(await aislada()).toBe(false);
    vi.doUnmock("@/flags");
  });
});
