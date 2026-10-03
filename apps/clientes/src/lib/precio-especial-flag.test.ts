import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { precioEspecialCuenta } from "./precio-especial-flag";

describe("precioEspecialCuenta", () => {
  it("apagado por defecto", async () => {
    expect(await precioEspecialCuenta()).toBe(false);
  });

  it("prendido desde Vercel Flags", async () => {
    setFlag("precio-especial-cuenta", true);
    expect(await precioEspecialCuenta()).toBe(true);
  });

  it("si el flag no se puede evaluar, asume apagado", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      precioEspecialCuentaFlag: async () => {
        throw new Error("sin red");
      },
    }));
    const { precioEspecialCuenta: aislada } = await import("./precio-especial-flag");
    expect(await aislada()).toBe(false);
    vi.doUnmock("@/flags");
  });
});
