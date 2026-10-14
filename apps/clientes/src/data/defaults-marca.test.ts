import { describe, expect, it } from "vitest";
import {
  DEFAULTS_HOME,
  SECCIONES_HOME,
  combinarContenidoHome,
  defaultsHomeDe,
  defaultsHomeGenerica,
  erroresSeccion,
  visibilidadDe,
} from "./home-defaults";
import { DEFAULTS_FOOTER, defaultsFooterDe, resolverDatosFooter, textoBarra, validarDatosFooter } from "./footer";
import { MARCA_POR_DEFECTO, resolverMarca } from "@/lib/marca-base";

const generica = resolverMarca({ base: "generica", nombre: "Tienda Uno", descripcion: "Descripción propia." });

describe("defaults según la base de la marca", () => {
  it("central: son los DEFAULTS de siempre, la misma referencia", () => {
    expect(defaultsHomeDe(MARCA_POR_DEFECTO)).toBe(DEFAULTS_HOME);
    expect(defaultsFooterDe(MARCA_POR_DEFECTO)).toBe(DEFAULTS_FOOTER);
  });

  it("central sin pasar defaults: combinarContenidoHome sigue dando DEFAULTS_HOME", () => {
    expect(combinarContenidoHome([])).toEqual(DEFAULTS_HOME);
    expect(combinarContenidoHome([], defaultsHomeDe(MARCA_POR_DEFECTO))).toEqual(DEFAULTS_HOME);
  });
});

describe("home genérica", () => {
  const home = defaultsHomeGenerica(generica);

  it("arranca con hero, marquee y ambientes ocultos (y los banners deco)", () => {
    for (const s of ["hero", "marquee", "ambientes", "bannerDeco", "decoGrid"] as const) {
      expect(visibilidadDe(home.visibilidad, s), s).toBe("nunca");
    }
  });

  it("destacados, servicios y WhatsApp quedan visibles; sin anuncio ni badge", () => {
    for (const s of ["destacados", "servicios", "whatsapp"] as const) {
      expect(visibilidadDe(home.visibilidad, s), s).toBe("siempre");
    }
    expect(home.anuncio.texto).toBeUndefined();
    expect(home.navBadge).toBeNull();
    expect(home.destacados.skus).toEqual([]);
  });

  it("todas las secciones validan (el editor las abre sin errores)", () => {
    for (const key of SECCIONES_HOME) {
      if (key === "navBadge") continue;
      expect(erroresSeccion(key, home[key as keyof typeof home]), key).toEqual([]);
    }
  });

  it("sin referencias a Central, a Puerto Iguazú ni a las marcas de Central", () => {
    const json = JSON.stringify(home);
    expect(json).not.toMatch(/central|iguaz|\/images\/marcas|central-led/i);
  });

  it("combinarContenidoHome parte de los defaults genéricos; lo guardado pisa sección por sección", () => {
    expect(combinarContenidoHome([], home)).toEqual(home);
    const hero = { ...home.hero, titulo: "Título propio" };
    const out = combinarContenidoHome([{ key: "hero", payload: hero }], home);
    expect(out.hero.titulo).toBe("Título propio");
    expect(out.destacados).toEqual(home.destacados);
    // Sin fila `ocultas`, el hero sigue oculto por default aunque ya tenga contenido.
    expect(visibilidadDe(out.visibilidad, "hero")).toBe("nunca");
  });

  it("al mostrar una sección el editor la guarda 'siempre': gana sobre el default oculto", () => {
    const out = combinarContenidoHome([{ key: "ocultas", payload: { hero: "siempre" } }], home);
    expect(visibilidadDe(out.visibilidad, "hero")).toBe("siempre");
    expect(visibilidadDe(out.visibilidad, "marquee")).toBe("nunca");
  });
});

describe("footer genérico", () => {
  const footer = defaultsFooterDe(generica);

  it("descripción de la marca, sin locales, WhatsApp ni enlaces; barra con el nombre", () => {
    expect(footer.descripcion).toBe("Descripción propia.");
    expect(footer.locales).toEqual([]);
    expect(footer.whatsapp).toBe("");
    expect(footer.enlaces).toEqual([]);
    expect(textoBarra(footer.barraIzquierda, 2031)).toBe("© 2031 Tienda Uno");
    expect(footer.barraDerecha).toBe("");
  });

  it("es válido para el editor y no nombra a Central ni a Puerto Iguazú", () => {
    expect(validarDatosFooter(footer).ok).toBe(true);
    expect(JSON.stringify(footer)).not.toMatch(/central|iguaz/i);
  });

  it("resolverDatosFooter hereda de los defaults que se le pasan", () => {
    expect(resolverDatosFooter(undefined, footer)).toEqual(footer);
    expect(resolverDatosFooter({ descripcion: "Otra" }, footer)).toEqual({ ...footer, descripcion: "Otra" });
    expect(resolverDatosFooter(undefined)).toEqual(DEFAULTS_FOOTER);
  });

  it("sin descripción en la marca usa una frase con el nombre", () => {
    const sinDesc = defaultsFooterDe(resolverMarca({ base: "generica", nombre: "Tienda Dos" }));
    expect(sinDesc.descripcion).toBe("Tienda online de Tienda Dos.");
  });
});
