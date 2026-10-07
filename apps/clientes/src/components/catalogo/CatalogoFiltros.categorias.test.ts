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
  it("con búsqueda lista el árbol completo, también las categorías sin resultados", () => {
    const html = renderizar({ q: "foco" });
    const t = texto(html);
    // Las raíces se ven con su conteo (0 incluido); las subcategorías están plegadas bajo su madre.
    for (const nombre of ["Iluminación 1", "Electricidad 0", "Seguridad 0"]) expect(t).toContain(nombre);
    expect(html).toContain("Ver subcategorías de Iluminación");
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

describe("CatalogoFiltros: marcas (regla de ceros)", () => {
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

  it("el conteo plano de atributos no se dibuja en el panel (las características salen por tipo)", () => {
    const t = renderizarCon(conFiltros);
    expect(t).not.toContain("Tono de luz");
    expect(t).not.toContain("Zócalo");
    expect(t).not.toContain("Rosca E27");
  });
});
