import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Facetas } from "@/lib/catalog";
import { leerEstado } from "@/lib/catalogo-url";
import { CatalogoFiltros } from "./CatalogoFiltros";

/**
 * En una página de marca (`/marcas/<slug>`) la marca la fija la página: el panel no muestra el
 * grupo "Marcas" (vacío, decía "Sin marcas para estos filtros"). En `/catalogo` sigue igual.
 */
const facetas: Facetas = { categorias: [], marcas: [{ label: "ACME", count: 3 }], atributos: [], precio: null };
const render = (sinMarcas?: boolean) =>
  renderToStaticMarkup(createElement(CatalogoFiltros, { facetas, estado: leerEstado({}), ir: () => {}, sinMarcas }));

describe("CatalogoFiltros sinMarcas", () => {
  it("por defecto muestra el grupo Marcas", () => {
    expect(render()).toContain(">Marcas<");
  });

  it("con sinMarcas no lo muestra", () => {
    expect(render(true)).not.toContain(">Marcas<");
    expect(render(true)).not.toContain("Sin marcas para estos filtros");
  });
});
