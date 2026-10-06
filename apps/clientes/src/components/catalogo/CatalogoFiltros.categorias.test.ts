import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Facetas } from "@/lib/catalog";
import { leerEstado } from "@/lib/catalogo-url";
import { CatalogoFiltros } from "./CatalogoFiltros";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Facetas con el árbol completo: la búsqueda sólo deja resultados en Focos led. */
const facetas: Facetas = {
  categorias: [
    { label: "ILUMINACION", count: 1, nivel: 1 },
    { label: "FOCOS LED", count: 1, nivel: 2 },
    { label: "TIRAS LED", count: 0, nivel: 2 },
    { label: "ELECTRICIDAD", count: 0, nivel: 1 },
    { label: "SEGURIDAD", count: 0, nivel: 1 },
  ],
  marcas: [],
  atributos: [],
  precio: null,
};

const renderizar = (params: Parameters<typeof leerEstado>[0]) =>
  renderToStaticMarkup(createElement(CatalogoFiltros, { facetas, estado: leerEstado(params), ir: () => {} }));

describe("CatalogoFiltros: categorías", () => {
  it("con búsqueda lista las categorías con productos y su madre; las de 0 no se muestran", () => {
    const html = renderizar({ q: "foco" });
    const t = texto(html);
    expect(t).toContain("Iluminación 1");
    expect(html).toContain("Ver subcategorías de Iluminación");
    for (const nombre of ["Electricidad", "Seguridad"]) expect(t).not.toContain(nombre);
  });

  it("una categoría tildada que cuenta 0 se sigue mostrando, con su 0", () => {
    const t = texto(renderizar({ categoria: "ELECTRICIDAD" }));
    expect(t).toContain("Electricidad 0");
    expect(t).not.toContain("Seguridad");
  });

  it("las categorías con 0 no quedan deshabilitadas", () => {
    const html = renderizar({ q: "foco" });
    expect(html).not.toMatch(/ disabled=/);
  });

  it("sin búsqueda es el mismo árbol", () => {
    const sin = texto(renderizar({}));
    const con = texto(renderizar({ q: "foco" }));
    expect(con).toBe(sin);
  });
});

describe("CatalogoFiltros: marcas y características (regla de ceros, subtítulos)", () => {
  const conFiltros: Facetas = {
    ...facetas,
    marcas: [
      { label: "Aurora", count: 4 },
      { label: "Zafiro", count: 0 },
    ],
    atributos: [
      { label: "tono-calido", count: 6 },
      { label: "zocalo-e27", count: 2 },
      { label: "zocalo-e14", count: 0 },
    ],
  };
  const renderizarCon = (f: Facetas, params: Parameters<typeof leerEstado>[0] = {}) =>
    texto(renderToStaticMarkup(createElement(CatalogoFiltros, { facetas: f, estado: leerEstado(params), ir: () => {} })));

  it("oculta la marca con 0 y muestra la que tiene productos", () => {
    const t = renderizarCon(conFiltros);
    expect(t).toContain("Aurora 4");
    expect(t).not.toContain("Zafiro");
  });

  it("una marca tildada con 0 se sigue mostrando", () => {
    expect(renderizarCon(conFiltros, { marca: "Zafiro" })).toContain("Zafiro 0");
  });

  it("las características van bajo un subtítulo por grupo y sin los ítems en 0", () => {
    const t = renderizarCon(conFiltros);
    expect(t).toContain("Tono de luz");
    expect(t).toContain("Zócalo");
    expect(t).not.toContain("Ambiente");
    expect(t).toContain("Rosca E27 2");
    expect(t).not.toContain("Rosca E14");
  });
});
