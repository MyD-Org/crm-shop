import { describe, expect, it } from "vitest";
import { combinarContenidoHome } from "./home-datos";
import { DEFAULTS_HOME } from "@/data/home-defaults";

describe("combinarContenidoHome (lib)", () => {
  it("filas vacías → defaults", () => {
    expect(combinarContenidoHome([])).toEqual(DEFAULTS_HOME);
  });

  it("merge por sección con defaults", () => {
    const hero = { ...DEFAULTS_HOME.hero, titulo: "Título del CRM" };
    const out = combinarContenidoHome([
      { key: "hero", payload: hero },
      { key: "anuncio", payload: { texto: 42 } },
    ]);
    expect(out.hero.titulo).toBe("Título del CRM");
    expect(out.anuncio).toEqual(DEFAULTS_HOME.anuncio);
    expect(out.destacados).toEqual(DEFAULTS_HOME.destacados);
  });

  it("visibilidad: por defecto el anuncio solo en desktop; de la DB sólo keys y valores conocidos", () => {
    expect(combinarContenidoHome([]).visibilidad).toEqual({ anuncio: "desktop" });
    const out = combinarContenidoHome([
      { key: "ocultas", payload: { whatsapp: "mobile", cualquiera: "nunca", hero: "a veces", anuncio: "siempre" } },
    ]);
    expect(out.visibilidad).toEqual({ anuncio: "siempre", whatsapp: "mobile" });
    expect(combinarContenidoHome([{ key: "ocultas", payload: 42 }]).visibilidad).toEqual({ anuncio: "desktop" });
  });

  it("visibilidad: el formato viejo (array de ocultas) se lee como \"nunca\"", () => {
    const out = combinarContenidoHome([{ key: "ocultas", payload: ["whatsapp", "cualquiera", "hero", "hero"] }]);
    expect(out.visibilidad).toEqual({ anuncio: "desktop", hero: "nunca", whatsapp: "nunca" });
  });
});

describe("combinarContenidoHome ignora la fila footer", () => {
  it("no es una sección de la home", () => {
    expect(combinarContenidoHome([{ key: "footer", payload: { descripcion: "Otra" } }])).toEqual(DEFAULTS_HOME);
  });
});
