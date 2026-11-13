import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { compraInvitadoHabilitada } from "./compra-invitado-flag";

describe("compraInvitadoHabilitada", () => {
  it("apagado por defecto", async () => {
    expect(await compraInvitadoHabilitada()).toBe(false);
  });

  it("refleja el valor del flag", async () => {
    setFlag("compra-invitado", true);
    expect(await compraInvitadoHabilitada()).toBe(true);
  });

  it("si el flag no se puede evaluar, queda apagado (fail-closed)", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      compraInvitadoFlag: async () => {
        throw new Error("sin conexión con Vercel Flags");
      },
    }));
    const { compraInvitadoHabilitada: fresco } = await import("./compra-invitado-flag");
    expect(await fresco()).toBe(false);
    vi.doUnmock("@/flags");
    vi.resetModules();
  });

  it("un valor que no es exactamente true cuenta como apagado", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({ compraInvitadoFlag: async () => "true" }));
    const { compraInvitadoHabilitada: fresco } = await import("./compra-invitado-flag");
    expect(await fresco()).toBe(false);
    vi.doUnmock("@/flags");
    vi.resetModules();
  });
});
