import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "./__fixtures__/tema-contrato.json";
import { TEMA_POR_DEFECTO } from "./tema-ip";
import {
  BASE_TEMA_POR_DEFECTO,
  atributosHtmlTema,
  coloresPwaDeTema,
  cssTemaTenant,
  marcaSobreOscuro,
  razonDeContraste,
  sanearTemaTenant,
  type ColoresTema,
} from "./tema-tenant";

const paletas = fixture.paletas as Record<string, ColoresTema>;
const ejemplo = paletas["calido-azul"];

describe("sanearTemaTenant (fixture tema-contrato.json, mismo contrato que el admin)", () => {
  for (const caso of fixture.validos) {
    it(`válido: ${caso.nombre}`, () => {
      const salida = caso.salida as { base?: string; colores?: ColoresTema };
      expect(sanearTemaTenant(caso.entrada)).toEqual({
        base: salida.base ?? BASE_TEMA_POR_DEFECTO,
        colores: salida.colores ?? null,
      });
    });
  }

  // El Shop es tolerante: lo inválido se descarta, el resto se conserva y nunca lanza.
  for (const caso of fixture.invalidos) {
    it(`inválido (se descarta, no lanza): ${caso.nombre}`, () => {
      expect(() => sanearTemaTenant(caso.entrada)).not.toThrow();
      const t = sanearTemaTenant(caso.entrada);
      expect(t.base).toBe(BASE_TEMA_POR_DEFECTO);
      expect(t.colores).toBeNull();
      expect(cssTemaTenant(caso.entrada)).toBeNull();
    });
  }

  for (const caso of fixture.contraste) {
    it(`contraste: ${caso.nombre}`, () => {
      const colores = { ...paletas[caso.paleta], ...caso.cambios };
      const t = sanearTemaTenant({ colores });
      expect(t.colores).toEqual(caso.ok ? colores : null);
    });
  }

  it("razones de contraste WCAG", () => {
    for (const r of fixture.razones) {
      expect(Math.round(razonDeContraste(r.a, r.b) * 100) / 100).toBe(r.ratio);
    }
  });

  it("un color inválido no rompe: la paleta propia se descarta entera y queda el tema de la base", () => {
    const t = sanearTemaTenant({ base: "calido", colores: { ...ejemplo, accent: "rojo" } });
    expect(t).toEqual({ base: "calido", colores: null });
  });
});

describe("cssTemaTenant", () => {
  it("sin tema (Central): null, cero CSS nuevo", () => {
    expect(cssTemaTenant({})).toBeNull();
    expect(cssTemaTenant(null)).toBeNull();
    expect(cssTemaTenant(undefined)).toBeNull();
    expect(cssTemaTenant({ base: "calido" })).toBeNull();
  });

  it("con paleta: UNA regla bajo :root[data-theme][data-tema=\"propio\"] con las 8 variables", () => {
    const css = cssTemaTenant({ colores: ejemplo })!;
    expect(css.startsWith(':root[data-theme][data-tema="propio"]{')).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css.match(/\{/g)).toHaveLength(1);
    expect(css).toContain(`--color-bg:${ejemplo.bg};`);
    expect(css).toContain(`--color-surface:${ejemplo.surface};`);
    expect(css).toContain(`--color-text:${ejemplo.text};`);
    expect(css).toContain(`--color-muted:${ejemplo.muted};`);
    expect(css).toContain(`--color-primary:${ejemplo.primary};`);
    expect(css).toContain(`--color-on-primary:${ejemplo.onPrimary};`);
    expect(css).toContain(`--color-accent:${ejemplo.accent};`);
    expect(css).toContain(`--color-surface-dark:${ejemplo.surfaceDark};`);
  });

  it("deriva el resto de los tokens con color-mix; la marca sobre oscuro es el acento 65% + blanco", () => {
    const css = cssTemaTenant({ colores: ejemplo })!;
    expect(css).toContain(`--color-marca-sobre-oscuro:color-mix(in srgb, ${ejemplo.accent} 65%, white);`);
    expect(css).toContain("--color-highlight:var(--color-marca-sobre-oscuro);");
    expect(css).toContain("--color-border:color-mix(");
    expect(css).toContain("--color-primary-soft:color-mix(");
    expect(css).toContain("--color-accent-soft:color-mix(");
    expect(css).toContain("--color-ring:");
  });

  it("no toca fuentes, radios ni semánticos (success/danger/warning quedan de la base)", () => {
    const css = cssTemaTenant({ colores: ejemplo })!;
    for (const prohibido of ["--font-", "--radius", "--shadow", "--color-success", "--color-danger", "--color-warning"]) {
      expect(css).not.toContain(prohibido);
    }
  });

  it("sólo emite hex validados: una inyección de CSS no pasa", () => {
    const css = cssTemaTenant({ colores: { ...ejemplo, bg: "#ffffff;}body{display:none" } });
    expect(css).toBeNull();
    const ok = cssTemaTenant({ colores: ejemplo })!;
    expect(ok).toMatch(/^[a-z0-9#:\[\]=",.;{}()%\- ]+$/i);
  });

  it("aislamiento: dos temas distintos no se mezclan", () => {
    const a = cssTemaTenant({ colores: paletas["calido-azul"] })!;
    const b = cssTemaTenant({ colores: { ...paletas.calido, accent: "#a8562a" } })!;
    expect(a).not.toBe(b);
    expect(a).not.toContain(paletas.calido.primary);
    expect(b).not.toContain(paletas["calido-azul"].primary);
    // función pura: repetirla da lo mismo
    expect(cssTemaTenant({ colores: paletas["calido-azul"] })).toBe(a);
  });

  it("el hover del primario se aleja de onPrimary (claro sobre oscuro: oscurece; oscuro sobre claro: aclara)", () => {
    const oscuro = cssTemaTenant({ colores: ejemplo })!;
    expect(oscuro).toMatch(/--color-primary-hover:color-mix\(in srgb, #16283f 85%, black\);/);
    const claro = cssTemaTenant({
      colores: { ...ejemplo, primary: "#f2f2f2", onPrimary: "#111111", text: "#111111" },
    })!;
    expect(claro).toMatch(/--color-primary-hover:color-mix\(in srgb, #f2f2f2 85%, white\);/);
  });
});

describe("marcaSobreOscuro (misma cuenta que el admin: 35% de blanco)", () => {
  it("mezcla lineal con blanco", () => {
    expect(marcaSobreOscuro("#000000")).toBe("#595959");
    expect(marcaSobreOscuro("#ffffff")).toBe("#ffffff");
  });
});

describe("atributosHtmlTema (caracterización de Central: HTML idéntico al de hoy)", () => {
  const html = (a: ReturnType<typeof atributosHtmlTema>) =>
    renderToStaticMarkup(<div data-theme={a.dataTheme} data-tema={a.dataTema} />);

  for (const sinTema of [{}, null, undefined, "x", { base: "calido-azul" }, { colores: { bg: "#fff" } }]) {
    it(`sin tema propio (${JSON.stringify(sinTema)}): ni data-tema ni <style>`, () => {
      const a = atributosHtmlTema(sinTema);
      expect(a.css).toBeNull();
      expect(a.dataTema).toBeUndefined();
      expect(html(a)).toBe('<div data-theme="calido-azul"></div>');
    });
  }

  it("la base del tema se respeta aun sin paleta propia", () => {
    const a = atributosHtmlTema({ base: "calido" });
    expect(html(a)).toBe('<div data-theme="calido"></div>');
    expect(a.css).toBeNull();
  });

  it("con paleta propia: data-tema=propio y el CSS", () => {
    const a = atributosHtmlTema({ colores: ejemplo });
    expect(a.dataTema).toBe("propio");
    expect(a.css).toBe(cssTemaTenant({ colores: ejemplo }));
    expect(html(a)).toBe('<div data-theme="calido-azul" data-tema="propio"></div>');
  });
});

describe("coloresPwaDeTema (manifest y OG sólo con tema propio)", () => {
  it("sin paleta: null", () => {
    expect(coloresPwaDeTema({})).toBeNull();
  });
  it("con paleta: fondo = bg, tema = primary, y los de la imagen OG", () => {
    expect(coloresPwaDeTema({ colores: ejemplo })).toEqual({
      fondo: ejemplo.bg,
      tema: ejemplo.primary,
      tinta: ejemplo.text,
      suave: ejemplo.muted,
      acento: ejemplo.accent,
    });
  });
});

describe("coherencia", () => {
  it("la base por defecto es el tema por defecto del sitio", () => {
    expect(BASE_TEMA_POR_DEFECTO).toBe(TEMA_POR_DEFECTO);
  });

  it("sanear es idempotente (el layout vuelve a sanear lo que ya devolvió getTemaTenant)", () => {
    const una = sanearTemaTenant({ base: "calido", colores: ejemplo });
    expect(sanearTemaTenant(una)).toEqual(una);
  });
});
