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
});
