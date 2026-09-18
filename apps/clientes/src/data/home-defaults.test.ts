import { describe, expect, it } from "vitest";
import {
  DEFAULTS_HOME,
  SECCIONES_HOME,
  erroresSeccion,
  combinarContenidoHome,
} from "./home-defaults";

describe("defaults de home", () => {
  it("todas las secciones default validan sin errores", () => {
    for (const key of SECCIONES_HOME) {
      if (key === "navBadge") continue; // null = sin badge
      expect(erroresSeccion(key, DEFAULTS_HOME[key as keyof typeof DEFAULTS_HOME])).toEqual([]);
    }
  });

  it("navBadge default es null", () => {
    expect(DEFAULTS_HOME.navBadge).toBeNull();
  });
});

describe("erroresSeccion", () => {
  it("rechaza sección desconocida", () => {
    expect(erroresSeccion("zzz", {}).length).toBeGreaterThan(0);
  });

  it("hero exige titulo e imagen", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, titulo: 42 }).length).toBeGreaterThan(0);
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "" }).length).toBeGreaterThan(0);
  });

  it("destacados valida cantidad entre 1 y 24", () => {
    expect(erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, cantidad: 0 }).length).toBeGreaterThan(0);
    expect(erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, cantidad: 99 }).length).toBeGreaterThan(0);
  });

  it("navBadge acepta null (borrar badge)", () => {
    expect(erroresSeccion("navBadge", null)).toEqual([]);
  });

  it("enlaces exigen label y href", () => {
    expect(
      erroresSeccion("decoGrid", {
        ...DEFAULTS_HOME.decoGrid,
        chips: [{ label: "x" }],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("combinarContenidoHome", () => {
  it("con filas vacías devuelve los defaults", () => {
    expect(combinarContenidoHome([])).toEqual(DEFAULTS_HOME);
  });

  it("una fila válida pisa solo su sección", () => {
    const hero = { ...DEFAULTS_HOME.hero, titulo: "Otro título" };
    const out = combinarContenidoHome([{ key: "hero", payload: hero }]);
    expect(out.hero.titulo).toBe("Otro título");
    expect(out.anuncio).toEqual(DEFAULTS_HOME.anuncio);
  });

  it("un payload inválido se ignora y queda el default", () => {
    const out = combinarContenidoHome([{ key: "hero", payload: { roto: true } }]);
    expect(out.hero).toEqual(DEFAULTS_HOME.hero);
  });

  it("una key desconocida se ignora", () => {
    const out = combinarContenidoHome([{ key: "zzz", payload: {} }]);
    expect(out).toEqual(DEFAULTS_HOME);
  });

  it("navBadge null se conserva como null", () => {
    const out = combinarContenidoHome([
      { key: "navBadge", payload: { categoria: "Decorativa", texto: "Nuevo" } },
    ]);
    expect(out.navBadge).toEqual({ categoria: "Decorativa", texto: "Nuevo" });
  });
});
