import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { pedidoAConfirmarHabilitado } from "./pedido-a-confirmar-flag";

/** Lee el flag `pedido-a-confirmar` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("pedidoAConfirmarHabilitado", () => {
  it("apagado por defecto", async () => {
    expect(await pedidoAConfirmarHabilitado()).toBe(false);
  });

  it("prendido cuando el flag lo está, sin depender de `sucursales`", async () => {
    setFlag("pedido-a-confirmar", true);
    expect(await pedidoAConfirmarHabilitado()).toBe(true);
  });

  it("si el proveedor falla, se asume apagado", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      pedidoAConfirmarFlag: async () => {
        throw new Error("sin red");
      },
    }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pedidoAConfirmarHabilitado: leer } = await import("./pedido-a-confirmar-flag");
    expect(await leer()).toBe(false);
    err.mockRestore();
    vi.doUnmock("@/flags");
  });
});
