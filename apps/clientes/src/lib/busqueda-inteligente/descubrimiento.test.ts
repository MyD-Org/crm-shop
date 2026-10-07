import { describe, expect, it } from "vitest";
import { hrefBusqueda, placeholderBuscador, vistaDesplegable } from "./descubrimiento";

describe("placeholderBuscador", () => {
  it("sin el flag, el de siempre", () => {
    expect(placeholderBuscador(false, 3)).toBe("Buscar");
  });

  it("con el flag rota entre un código, una necesidad y un uso", () => {
    const vistos = [0, 1, 2].map((i) => placeholderBuscador(true, i));
    expect(new Set(vistos).size).toBe(3);
    expect(placeholderBuscador(true, 3)).toBe(vistos[0]);
    expect(vistos[0]).toMatch(/^Buscar «.+»$/);
  });
});

describe("vistaDesplegable", () => {
  const base = { busquedaIa: true, abierto: true, texto: "", textoDebounced: "" };

  it("enfocado y vacío con el flag ⇒ guía; sin el flag ⇒ nada", () => {
    expect(vistaDesplegable(base)).toBe("guia");
    expect(vistaDesplegable({ ...base, busquedaIa: false })).toBeNull();
  });

  it("al escribir desaparece la guía y vuelve el autocompletado", () => {
    expect(vistaDesplegable({ ...base, texto: "r" })).toBeNull();
    expect(vistaDesplegable({ ...base, texto: "ref", textoDebounced: "ref" })).toBe("resultados");
    expect(vistaDesplegable({ ...base, busquedaIa: false, texto: "ref", textoDebounced: "ref" })).toBe("resultados");
  });

  it("cerrado ⇒ nada", () => {
    expect(vistaDesplegable({ ...base, abierto: false })).toBeNull();
  });
});

describe("hrefBusqueda", () => {
  it("sólo la consulta, codificada: sin filtros (el catálogo aplica su default de stock)", () => {
    expect(hrefBusqueda("  luz cálida ")).toBe("/catalogo?q=luz%20c%C3%A1lida");
  });

  it("con el flag `busqueda-ia`, a /buscar (la búsqueda v2 entiende y redirige)", () => {
    expect(hrefBusqueda("  luz cálida ", true)).toBe("/buscar?q=luz+c%C3%A1lida");
  });
});
