import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Facetas } from "@/lib/catalog";
import type { FacetaClave } from "@/lib/catalogo-facetas-registro";
import { leerEstado } from "@/lib/catalogo-url";
import { CatalogoFiltros } from "./CatalogoFiltros";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const polos: FacetaClave = {
  clave: "polos",
  titulo: "Polos",
  control: "lista",
  visibles: 6,
  items: [
    { valor: "1", etiqueta: "1", count: 12 },
    { valor: "2", etiqueta: "2", count: 7 },
  ],
};
const flujo: FacetaClave = { clave: "flujo_lm", titulo: "Flujo luminoso", control: "rango", unidad: "lm", rango: { min: 100, max: 5000 } };
const potencia: FacetaClave = { clave: "potencia_w", titulo: "Potencia", control: "rango", unidad: "W", rango: { min: 3, max: 200 }, param: "potencia" };

const base: Facetas = {
  categorias: [
    { label: "ELECTRICIDAD", count: 20, nivel: 1 },
    { label: "TERMICAS", count: 19, nivel: 2 },
  ],
  marcas: [{ label: "MARCA UNO", count: 4 }],
  // Lo que traería el panel de siempre: un grupo de tono y el slider de potencia viejo.
  atributos: [{ label: "tono-calido", count: 3 }],
  precio: { min: 100, max: 90000 },
  potencia: { min: 3, max: 200 },
};

const renderizar = (facetas: Facetas, params: Parameters<typeof leerEstado>[0] = {}) =>
  renderToStaticMarkup(createElement(CatalogoFiltros, { facetas, estado: leerEstado(params), ir: () => {} }));

describe("CatalogoFiltros con el flag apagado (porClave ausente)", () => {
  it("queda el panel de siempre: Características planas y slider de potencia, sin aviso", () => {
    const t = texto(renderizar(base, { categoria: "TERMICAS" }));
    expect(t).toContain("Tono de luz");
    expect(t).toContain("Potencia");
    expect(t).not.toContain("Elija una categoría");
  });

  it("Disponibilidad sigue al final, después del precio", () => {
    const t = texto(renderizar(base, { categoria: "TERMICAS" }));
    expect(t.indexOf("Precio")).toBeLessThan(t.indexOf("Disponibilidad"));
  });
});

describe("CatalogoFiltros con facetas por tipo (porClave presente)", () => {
  it("sin categoría ni búsqueda: el aviso, sin grupos por tipo ni Características planas", () => {
    const t = texto(renderizar({ ...base, porClave: [] }));
    expect(t).toContain("Elija una categoría para ver más filtros");
    expect(t).not.toContain("Tono de luz");
    expect(t).not.toContain("Potencia");
    expect(t).toContain("Categorías");
    expect(t).toContain("Marcas");
    expect(t).toContain("Precio");
    expect(t).toContain("Disponibilidad");
  });

  it("con categoría: un grupo por clave de lista, con sus valores y conteos", () => {
    const t = texto(renderizar({ ...base, porClave: [polos] }, { categoria: "TERMICAS" }));
    expect(t).toContain("Polos");
    expect(t).toMatch(/1\s*12/);
    expect(t).toMatch(/2\s*7/);
    expect(t).not.toContain("Elija una categoría");
  });

  it("ya no muestra el grupo plano de Características ni el slider de potencia viejo", () => {
    const t = texto(renderizar({ ...base, porClave: [polos] }, { categoria: "TERMICAS" }));
    expect(t).not.toContain("Tono de luz");
    expect(t).not.toContain("Potencia");
  });

  it("una clave de rango dibuja su slider con el título y la unidad", () => {
    const html = renderizar({ ...base, porClave: [flujo] }, { categoria: "TERMICAS" });
    const t = texto(html);
    expect(t).toContain("Flujo luminoso");
    expect(t).toMatch(/100 lm\s*–\s*5\.000 lm/);
    expect(html).toContain('aria-label="Flujo luminoso"');
  });

  it("la potencia es una faceta de rango más (potencia_min/max), sin ids de potencia en listas", () => {
    const t = texto(renderizar({ ...base, porClave: [potencia] }, { categoria: "TERMICAS", potencia_min: "10", potencia_max: "50" }));
    expect(t).toContain("Potencia");
    expect(t).toMatch(/10 W\s*–\s*50 W/);
  });

  it("los valores tildados salen marcados", () => {
    const sin = renderizar({ ...base, porClave: [polos] }, { categoria: "TERMICAS" });
    const con = renderizar({ ...base, porClave: [polos] }, { categoria: "TERMICAS", car: "polos:2" });
    const tildes = (h: string) => (h.match(/aria-checked="true"[^>]*aria-label="(\d+)"/g) ?? []).map((m) => m.match(/aria-label="(\d+)"/)![1]);
    expect(tildes(sin)).toEqual([]);
    expect(tildes(con)).toEqual(["2"]);
  });

  it("Disponibilidad va debajo de Marcas y antes de los grupos por tipo y del precio", () => {
    const t = texto(renderizar({ ...base, porClave: [polos] }, { categoria: "TERMICAS" }));
    expect(t.indexOf("Marcas")).toBeLessThan(t.indexOf("Disponibilidad"));
    expect(t.indexOf("Disponibilidad")).toBeLessThan(t.indexOf("Polos"));
    expect(t.indexOf("Polos")).toBeLessThan(t.indexOf("Precio"));
  });

  it("categoría raíz sin claves elegibles: aviso de categoría más específica", () => {
    const t = texto(renderizar({ ...base, porClave: [] }, { categoria: "ELECTRICIDAD" }));
    expect(t).toContain("Elija una categoría más específica para ver más filtros");
  });
});
