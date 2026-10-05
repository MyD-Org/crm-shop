import { describe, expect, it } from "vitest";
import { resolverSalida, rutaIgnoradaPorGit, type DepsGit } from "./ruta-salida";

const RAIZ = "/repo";
/** Git falso: ignora lo que cuelga de /repo/tmp/ o termina en .local.json. */
const git: DepsGit = {
  raiz: () => RAIZ,
  ignorada: (ruta) => ruta.startsWith("/repo/tmp/") || ruta.endsWith(".local.json"),
};

describe("rutaIgnoradaPorGit", () => {
  it("una ruta dentro del repo y ignorada devuelve true", () => {
    expect(rutaIgnoradaPorGit("/repo/tmp/x.json", git)).toBe(true);
    expect(rutaIgnoradaPorGit("/repo/apps/clientes/banco-real.local.json", git)).toBe(true);
  });

  it("una ruta dentro del repo y NO ignorada devuelve false", () => {
    expect(rutaIgnoradaPorGit("/repo/apps/clientes/salida.json", git)).toBe(false);
  });

  it("una ruta fuera del repo cuenta como segura (true) sin consultar a git", () => {
    const sinGit: DepsGit = { raiz: () => RAIZ, ignorada: () => { throw new Error("no debería llamarse"); } };
    expect(rutaIgnoradaPorGit("/otro/lugar/x.json", sinGit)).toBe(true);
    expect(rutaIgnoradaPorGit("/repo/../afuera/x.json", sinGit)).toBe(true);
  });

  it("una ruta relativa se resuelve contra el directorio de trabajo", () => {
    const g: DepsGit = { raiz: () => RAIZ, ignorada: (r) => r === "/repo/tmp/x.json" };
    expect(rutaIgnoradaPorGit("tmp/x.json", g, "/repo")).toBe(true);
    expect(rutaIgnoradaPorGit("x.json", g, "/repo")).toBe(false);
  });
});

describe("resolverSalida", () => {
  it("modo laxo: ruta no ignorada devuelve advertencia pero no falla", () => {
    const r = resolverSalida("/repo/salida.json", { estricto: false }, git);
    expect(r.ruta).toBe("/repo/salida.json");
    expect(r.advertencia).toMatch(/no está ignorad/i);
  });

  it("modo laxo: ruta ignorada sin advertencia", () => {
    expect(resolverSalida("/repo/tmp/x.json", { estricto: false }, git).advertencia).toBeUndefined();
  });

  it("modo estricto: ruta no ignorada aborta con mensaje claro", () => {
    expect(() => resolverSalida("/repo/salida.json", { estricto: true }, git)).toThrow(/no está ignorad/i);
  });

  it("modo estricto: ruta ignorada o fuera del repo se acepta", () => {
    expect(resolverSalida("/repo/tmp/x.json", { estricto: true }, git).ruta).toBe("/repo/tmp/x.json");
    expect(resolverSalida("/afuera/x.json", { estricto: true }, git).advertencia).toBeUndefined();
  });

  it("el mensaje de error no incluye contenido, solo la ruta", () => {
    try {
      resolverSalida("/repo/salida.json", { estricto: true }, git);
    } catch (e) {
      expect((e as Error).message).toContain("/repo/salida.json");
    }
  });
});
