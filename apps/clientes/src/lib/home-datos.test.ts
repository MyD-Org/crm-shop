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
      { key: "anuncio", payload: { malo: 1 } },
    ]);
    expect(out.hero.titulo).toBe("Título del CRM");
    expect(out.anuncio).toEqual(DEFAULTS_HOME.anuncio);
    expect(out.destacados).toEqual(DEFAULTS_HOME.destacados);
  });

  it("ocultas: por defecto ninguna; de la DB sólo keys conocidas", () => {
    expect(combinarContenidoHome([]).ocultas).toEqual([]);
    const out = combinarContenidoHome([{ key: "ocultas", payload: ["whatsapp", "cualquiera", "hero", "hero"] }]);
    expect(out.ocultas).toEqual(["hero", "whatsapp"]);
    expect(combinarContenidoHome([{ key: "ocultas", payload: { malo: 1 } }]).ocultas).toEqual([]);
  });
});
