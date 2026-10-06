import { describe, expect, it } from "vitest";
import type { FacetaClave } from "./catalogo-facetas-registro";
import type { EstadoCatalogo } from "./catalogo-url";
import {
  AVISO_ELEGIR_CATEGORIA,
  AVISO_ELEGIR_CATEGORIA_ESPECIFICA,
  chipsActivos,
  contarFiltrosActivos,
  hayFiltros,
  indexable,
  itemsDeFacetaClave,
  limpiarFiltros,
  panelPorTipo,
} from "./catalogo-vista";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  atributos: [],
  caracteristicas: [],
  orden: "nombre",
  pagina: 1,
  soloStock: true,
  vista: "grilla",
};

const sinEspaciosRaros = (s: string) => s.replace(/\s/g, " ");

describe("chips de características por tipo", () => {
  it("cada car tiene su chip ('Polos: 2', 'Curva: C') que lo quita; van entre atributos y potencia", () => {
    const estado: EstadoCatalogo = {
      ...base,
      categorias: ["TERMICAS"],
      atributos: ["tono-calido"],
      caracteristicas: ["polos:2", "polos:4", "curva:c"],
      potenciaMin: 10,
      potenciaMax: 50,
    };
    const chips = chipsActivos(estado, null).map((c) => ({ ...c, etiqueta: sinEspaciosRaros(c.etiqueta) }));
    expect(chips.map((c) => c.etiqueta)).toEqual([
      "Termicas",
      "Luz cálida",
      "Polos: 2",
      "Polos: 4",
      "Curva: C",
      "Potencia: 10 – 50 W",
    ]);
    const polos2 = chips.find((c) => c.etiqueta === "Polos: 2")!;
    expect(polos2.removeLabel).toBe("Quitar filtro Polos: 2");
    expect(polos2.cambios).toEqual({ caracteristicas: ["polos:4", "curva:c"] });
    expect(new Set(chips.map((c) => c.clave)).size).toBe(chips.length);
  });

  it("un rango se muestra con su unidad", () => {
    const chips = chipsActivos({ ...base, caracteristicas: ["flujo_lm:800-1200"] }, null);
    expect(sinEspaciosRaros(chips[0].etiqueta)).toBe("Flujo luminoso: 800 – 1200 lm");
  });
});

describe("car en limpiar, hayFiltros, contador e indexable", () => {
  it("limpiarFiltros vacía las características", () => {
    expect(limpiarFiltros().caracteristicas).toEqual([]);
  });

  it("hayFiltros y el contador cuentan cada car", () => {
    expect(hayFiltros({ ...base, caracteristicas: ["polos:2"] })).toBe(true);
    expect(contarFiltrosActivos({ ...base, caracteristicas: ["polos:2", "polos:4", "curva:c"] })).toBe(3);
    expect(contarFiltrosActivos({ ...base, categorias: ["A"], caracteristicas: ["polos:2"] })).toBe(2);
  });

  it("una URL con car no es indexable", () => {
    expect(indexable({ ...base, categorias: ["TERMICAS"] })).toBe(true);
    expect(indexable({ ...base, categorias: ["TERMICAS"], caracteristicas: ["polos:2"] })).toBe(false);
  });
});

const lista = (clave: string, titulo: string, items: [string, string, number][]): FacetaClave => ({
  clave: clave as never,
  titulo,
  control: "lista",
  items: items.map(([valor, etiqueta, count]) => ({ valor, etiqueta, count })),
  visibles: 6,
});

describe("panelPorTipo (qué muestra el panel con el flag prendido)", () => {
  const arbol = [
    { label: "ELECTRICIDAD", count: 10, nivel: 1 },
    { label: "TERMICAS", count: 4, nivel: 2 },
    { label: "LLAVES", count: 6, nivel: 2 },
    { label: "MATERIALES", count: 3, nivel: 1 },
  ];
  const grupos = [lista("polos", "Polos", [["2", "2", 3], ["4", "4", 1]])];

  it("porClave ausente (flag apagado, tabla ausente o falla): el panel de siempre", () => {
    expect(panelPorTipo(undefined, base, arbol)).toEqual({ modo: "actual" });
    expect(panelPorTipo(undefined, { ...base, categorias: ["TERMICAS"] }, arbol)).toEqual({ modo: "actual" });
  });

  it("sin categoría ni búsqueda: no hay grupos y se pide elegir una categoría", () => {
    expect(panelPorTipo([], base, arbol)).toEqual({ modo: "aviso", texto: AVISO_ELEGIR_CATEGORIA });
    expect(AVISO_ELEGIR_CATEGORIA).toBe("Elija una categoría para ver más filtros");
  });

  it("con categoría o con búsqueda, los grupos elegidos", () => {
    expect(panelPorTipo(grupos, { ...base, categorias: ["TERMICAS"] }, arbol)).toEqual({ modo: "grupos", grupos });
    expect(panelPorTipo(grupos, { ...base, query: "termica 2x20" }, arbol)).toEqual({ modo: "grupos", grupos });
  });

  it("con un car activo y sin categoría ni búsqueda siguen los grupos (hay que poder quitarlo)", () => {
    expect(panelPorTipo(grupos, { ...base, caracteristicas: ["polos:2"] }, arbol)).toEqual({ modo: "grupos", grupos });
  });

  it("categoría raíz sin ninguna clave elegible: 'más específica'", () => {
    expect(panelPorTipo([], { ...base, categorias: ["ELECTRICIDAD"] }, arbol)).toEqual({
      modo: "aviso",
      texto: AVISO_ELEGIR_CATEGORIA_ESPECIFICA,
    });
    expect(AVISO_ELEGIR_CATEGORIA_ESPECIFICA).toBe("Elija una categoría más específica para ver más filtros");
  });

  it("una búsqueda sin ninguna clave elegible también invita a elegir una categoría más específica", () => {
    expect(panelPorTipo([], { ...base, query: "cosas" }, arbol)).toEqual({
      modo: "aviso",
      texto: AVISO_ELEGIR_CATEGORIA_ESPECIFICA,
    });
  });

  it("categoría hoja sin claves elegibles: nada que decir", () => {
    expect(panelPorTipo([], { ...base, categorias: ["TERMICAS"] }, arbol)).toEqual({ modo: "vacio" });
  });
});

describe("itemsDeFacetaClave", () => {
  const faceta = lista("polos", "Polos", [["1", "1", 2], ["2", "2", 5]]) as Extract<FacetaClave, { control: "lista" }>;

  it("un ítem por valor, con su etiqueta, conteo y tilde", () => {
    expect(itemsDeFacetaClave(faceta, ["polos:2"])).toEqual([
      { value: "1", label: "1", count: 2, checked: false },
      { value: "2", label: "2", count: 5, checked: true },
    ]);
  });

  it("un valor tildado que ya no cuenta sigue apareciendo primero, con 0", () => {
    expect(itemsDeFacetaClave(faceta, ["polos:4"])).toEqual([
      { value: "4", label: "4", count: 0, checked: true },
      { value: "1", label: "1", count: 2, checked: false },
      { value: "2", label: "2", count: 5, checked: false },
    ]);
  });

  it("ignora los car de otras claves", () => {
    expect(itemsDeFacetaClave(faceta, ["curva:c"]).every((i) => !i.checked)).toBe(true);
  });
});
