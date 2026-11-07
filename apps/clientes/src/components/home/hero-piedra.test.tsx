import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DEFAULTS_HOME } from "@/data/home-defaults";
import { HomeClient } from "../HomeClient";
import { EditorHero } from "./editores/EditorHero";
import { HeroPiedra } from "./HeroPiedra";
import { MarcaProvider } from "../MarcaProvider";
import { PIEDRA, PIEDRA_IMAGE, isPiedraImage } from "./escena-piedra";
import { STUDIO_IMAGE, STUDIO_IMAGE_NEUTRAL, isStudioImage } from "./hero-lights";

const home = (imagen: string) =>
  renderToStaticMarkup(
    createElement(HomeClient, {
      contenido: { ...DEFAULTS_HOME, hero: { ...DEFAULTS_HOME.hero, imagen } },
      destacados: null,
      tiendaOficial: null,
      promociones: null,
      busquedaAsistida: null,
    }),
  );

describe("el hero elige la escena según la imagen guardada", () => {
  it("el valor de la piedra dibuja HeroPiedra y no el estudio", () => {
    const h = home(PIEDRA_IMAGE);
    expect(h).toContain("data-hero-piedra");
    expect(h).not.toContain("data-interactive-hero");
    expect(h).toContain('aria-label="Encender el LA"');
    expect(h).toContain(PIEDRA_IMAGE);
  });

  it("el estudio sigue dibujando InteractiveHero y nada de la piedra", () => {
    for (const imagen of [DEFAULTS_HOME.hero.imagen, STUDIO_IMAGE]) {
      const h = home(imagen);
      expect(h).toContain("data-interactive-hero");
      expect(h).not.toContain("data-hero-piedra");
      expect(h).not.toContain("Encender el LA");
    }
  });

  it("un sitio propio puede elegir el estudio con la foto neutra y dibuja InteractiveHero", () => {
    const h = home(STUDIO_IMAGE_NEUTRAL);
    expect(isStudioImage(STUDIO_IMAGE_NEUTRAL)).toBe(true);
    expect(h).toContain("data-interactive-hero");
    expect(h).not.toContain("data-hero-piedra");
    expect(h).toContain(encodeURIComponent(STUDIO_IMAGE_NEUTRAL));
    expect(h).not.toContain(encodeURIComponent(STUDIO_IMAGE));
  });

  it("la foto neutra es idéntica a la del estudio de Central", () => {
    const base = join(__dirname, "../../../public");
    expect(readFileSync(join(base, STUDIO_IMAGE_NEUTRAL)).equals(readFileSync(join(base, STUDIO_IMAGE)))).toBe(true);
  });

  it("el estudio de Central sigue usando su foto de siempre", () => {
    expect(home(DEFAULTS_HOME.hero.imagen)).toContain(encodeURIComponent(STUDIO_IMAGE));
  });

  it("una foto cualquiera no prende ninguna escena", () => {
    const h = home("/images/otra-foto.webp");
    expect(h).not.toContain("data-interactive-hero");
    expect(h).not.toContain("data-hero-piedra");
  });

  it("sólo el valor exacto elige la piedra", () => {
    expect(isPiedraImage(PIEDRA_IMAGE)).toBe(true);
    expect(isPiedraImage(`${PIEDRA_IMAGE}?x=1`)).toBe(false);
    expect(isPiedraImage(STUDIO_IMAGE)).toBe(false);
  });

  it("apagada, la envoltura no agrega ni un nodo: la home del estudio queda igual", () => {
    expect(renderToStaticMarkup(createElement(HeroPiedra, { enabled: false } as never, createElement("p", null, "x")))).toBe("<p>x</p>");
  });
});

describe("EditorHero ofrece la escena de la piedra", () => {
  const editor = (imagen: string, recursosCentral = false) =>
    renderToStaticMarkup(
      createElement(
        MarcaProvider,
        { marca: { base: recursosCentral ? "central" : "generica", recursosCentral, nombre: "Tienda", lema: "" } } as never,
        createElement(EditorHero, { valor: { ...DEFAULTS_HOME.hero, imagen }, onChange: () => {} }),
      ),
    );

  it("el botón aparece para cualquier marca, en usted", () => {
    for (const central of [false, true]) {
      expect(editor("/images/otra-foto.webp", central)).toContain("Escena interactiva: piedra de Mar del Plata");
    }
  });

  it("ya elegida, no se vuelve a ofrecer", () => {
    expect(editor(PIEDRA_IMAGE)).not.toContain("Escena interactiva: piedra de Mar del Plata");
  });

  it("el estudio con lámparas se ofrece a cualquier marca", () => {
    for (const central of [false, true]) {
      expect(editor("/images/otra-foto.webp", central)).toContain("Escena interactiva: estudio con lámparas");
    }
    expect(editor(STUDIO_IMAGE_NEUTRAL)).not.toContain("Escena interactiva: estudio con lámparas");
  });

  it("el estudio sigue ofreciéndose sólo con los recursos de Central", () => {
    expect(editor("/images/otra-foto.webp", true)).toContain("Usar la foto interactiva del estudio");
    expect(editor("/images/otra-foto.webp", false)).not.toContain("Usar la foto interactiva del estudio");
  });
});

describe("la escena de la piedra no arrastra nada de Central", () => {
  const dir = join(__dirname);
  const archivos = ["escena-piedra.ts", "escena-piedra-controlador.ts", "HeroPiedra.tsx", "HeroPiedra.module.css"];
  it("ni en el código ni en el SVG estático", () => {
    const textos = [...archivos.map(a => readFileSync(join(dir, a), "utf8")), readFileSync(join(__dirname, "../../../public", PIEDRA_IMAGE), "utf8")];
    for (const t of textos) {
      expect(t).not.toMatch(/central/i);
      expect(t).not.toMatch(/images\/central-led/);
    }
  });
  it("la imagen estática existe y trae las mismas juntas que la escena", () => {
    const svg = readFileSync(join(__dirname, "../../../public", PIEDRA_IMAGE), "utf8");
    expect(svg).toContain(PIEDRA.juntas);
    expect(svg).toContain(PIEDRA.poligonoLA);
    expect(readdirSync(join(__dirname, "../../../public/images/luz-atlantica"))).toEqual(["piedra.svg"]);
  });
});
