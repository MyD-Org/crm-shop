import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { leerEstado, type EstadoCatalogo } from "@/lib/catalogo-url";
import { CatalogoChips } from "./CatalogoChips";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const renderizar = (params: Parameters<typeof leerEstado>[0], ir: (c: Partial<EstadoCatalogo>) => void = () => {}) =>
  renderToStaticMarkup(createElement(CatalogoChips, { estado: leerEstado(params), rango: null, ir }));

describe("CatalogoChips: la búsqueda como chip", () => {
  it("lo buscado va primero, como un chip removible, junto con lo entendido", () => {
    const t = texto(renderizar({ q: "lampara 9w", ia: "1", categoria: "ILUMINACION", atr: "potencia_w:9" }));
    expect(t.indexOf("Búsqueda: «lampara 9w»")).toBe(0);
    expect(t).toContain("Iluminación");
    expect(t).toContain("Potencia: 9 W");
  });

  it("sin búsqueda no hay chip de búsqueda", () => {
    expect(texto(renderizar({ categoria: "ILUMINACION" }))).not.toContain("Búsqueda:");
  });

  it("sin búsqueda ni filtros no renderiza nada", () => {
    expect(renderizar({})).toBe("");
  });

  it("el botón de quitar dice qué búsqueda saca", () => {
    expect(renderizar({ q: "foco" })).toContain("Quitar la búsqueda «foco»");
  });

  it("no queda la franja «Entendimos»", () => {
    expect(texto(renderizar({ q: "lampara", ia: "1", categoria: "ILUMINACION" }))).not.toContain("Entendimos");
  });
});
