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
