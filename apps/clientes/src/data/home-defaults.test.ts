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

  it("navBadge default trae el tag Nuevo de Iluminación (diseño aprobado)", () => {
    expect(DEFAULTS_HOME.navBadge).toEqual({
      categoria: "ILUMINACION",
      texto: "Nuevo",
    });
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

describe("compatibilidad de filas guardadas antes de skus/imagenes", () => {
  it("destacados viejo hereda skus/imagenes del default (no apaga lo curado)", () => {
    const viejo = { ...DEFAULTS_HOME.destacados } as Record<string, unknown>;
    delete viejo.skus;
    delete viejo.imagenes;
    const out = combinarContenidoHome([{ key: "destacados", payload: viejo }]);
    expect(out.destacados.skus).toEqual(DEFAULTS_HOME.destacados.skus);
    expect(out.destacados.imagenes).toEqual(DEFAULTS_HOME.destacados.imagenes);
  });

  it("destacados con skus propios los usa (no hereda los del default)", () => {
    const out = combinarContenidoHome([
      { key: "destacados", payload: { ...DEFAULTS_HOME.destacados, skus: ["OTRO-SKU"] } },
    ]);
    expect(out.destacados.skus).toEqual(["OTRO-SKU"]);
  });

  it("destacados rechaza imagenes externas (next/image no las sirve sin remotePatterns)", () => {
    expect(
      erroresSeccion("destacados", {
        ...DEFAULTS_HOME.destacados,
        imagenes: ["https://cdn.externa.com/foto.webp"],
      }).length,
    ).toBeGreaterThan(0);
  });
});
