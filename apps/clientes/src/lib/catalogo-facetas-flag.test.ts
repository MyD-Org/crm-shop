import { describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { catalogoFacetasPorTipoHabilitada } from "./catalogo-facetas-flag";

/** Lee el flag `catalogo-facetas-por-tipo` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("catalogoFacetasPorTipoHabilitada", () => {
  it("apagado por defecto", async () => {
    expect(await catalogoFacetasPorTipoHabilitada()).toBe(false);
  });

  it("prendido desde Vercel Flags", async () => {
    setFlag("catalogo-facetas-por-tipo", true);
    expect(await catalogoFacetasPorTipoHabilitada()).toBe(true);
  });

  it("si el flag no se puede evaluar, asume apagado", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      catalogoFacetasPorTipoFlag: async () => {
        throw new Error("sin red");
      },
    }));
    const { catalogoFacetasPorTipoHabilitada: aislada } = await import("./catalogo-facetas-flag");
    expect(await aislada()).toBe(false);
    vi.doUnmock("@/flags");
  });

  it("sólo el valor true prende el flag", async () => {
    vi.resetModules();
    vi.doMock("@/flags", () => ({ catalogoFacetasPorTipoFlag: async () => "si" }));
    const { catalogoFacetasPorTipoHabilitada: aislada } = await import("./catalogo-facetas-flag");
    expect(await aislada()).toBe(false);
    vi.doUnmock("@/flags");
  });
});
