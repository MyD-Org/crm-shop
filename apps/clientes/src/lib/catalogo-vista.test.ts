import { describe, expect, it } from "vitest";
import {
  itemsDeFaceta,
  anuncioResultados,
  chipsActivos,
  contadorProductos,
  contarFiltrosActivos,
  etiquetaBotonFiltros,
  etiquetaStock,
  fmtPesos,
  hayFiltros,
  indexable,
  limpiarFiltros,
  migas,
  tituloCatalogo,
} from "./catalogo-vista";
import type { EstadoCatalogo } from "./catalogo-url";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  orden: "nombre",
  pagina: 1,
  soloStock: false,
  vista: "grilla",
};

/** Normaliza el espacio que emita Intl (normal o duro) para comparar. */
const sinEspaciosRaros = (s: string) => s.replace(/\s/g, " ");

describe("migas", () => {
  it("sin categoría: Inicio / Catálogo", () => {
    expect(migas(base)).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Catálogo", href: "/catalogo" },
    ]);
  });

  it("con una categoría suma el rubro formateado, sin enlace", () => {
    expect(migas({ ...base, categorias: ["ILUMINACION"] })).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Catálogo", href: "/catalogo" },
      { label: "Iluminación" },
    ]);
  });

  it("con dos categorías no hay tercer ítem", () => {
    expect(migas({ ...base, categorias: ["ILUMINACION", "CABLES"] })).toHaveLength(2);
  });

  it("con búsqueda el último ítem es Resultados, aunque haya categoría", () => {
    expect(migas({ ...base, query: "led", categorias: ["ILUMINACION"] }).at(-1)).toEqual({
      label: "Resultados",
    });
  });
});

describe("tituloCatalogo", () => {
  it("la búsqueda gana sobre la categoría", () => {
    expect(tituloCatalogo({ ...base, query: "led", categorias: ["ILUMINACION"] })).toBe(
      'Resultados para "led"'
    );
  });

  it("categoría única: el rubro formateado", () => {
    expect(tituloCatalogo({ ...base, categorias: ["ILUMINACION"] })).toBe("Iluminación");
  });

  it("sin nada (o varias categorías): Catálogo", () => {
    expect(tituloCatalogo(base)).toBe("Catálogo");
    expect(tituloCatalogo({ ...base, categorias: ["A", "B"] })).toBe("Catálogo");
  });
});

describe("contadorProductos", () => {
  it("con varias páginas suma la página actual, con separador de miles", () => {
    expect(contadorProductos(2626, 2, 110)).toBe("2.626 productos · página 2 de 110");
  });

  it("singular, vacío y una sola página", () => {
    expect(contadorProductos(1, 1, 1)).toBe("1 producto");
    expect(contadorProductos(0, 1, 0)).toBe("Sin productos");
    expect(contadorProductos(24, 1, 1)).toBe("24 productos");
  });
});

describe("anuncioResultados", () => {
  it("anuncia lo que se ve y en qué página", () => {
    expect(anuncioResultados(24, 2626, 2, 110)).toBe(
      "Mostrando 24 de 2.626 productos, página 2 de 110"
    );
  });

  it("sin resultados", () => {
    expect(anuncioResultados(0, 0, 1, 0)).toBe("Sin resultados");
  });
});

describe("etiquetaStock", () => {
  it("pocas unidades con cantidad conocida", () => {
    expect(etiquetaStock({ stock: "low", stockQty: 3 })).toBe("¡Últimas 3!");
  });

  it("en cualquier otro caso deja el texto por defecto del DS", () => {
    expect(etiquetaStock({ stock: "low" })).toBeUndefined();
    expect(etiquetaStock({ stock: "in", stockQty: 40 })).toBeUndefined();
    expect(etiquetaStock({ stock: "out", stockQty: 0 })).toBeUndefined();
  });
});

describe("fmtPesos", () => {
  it("pesos argentinos sin decimales", () => {
    expect(sinEspaciosRaros(fmtPesos(50000))).toBe("$ 50.000");
  });
});

describe("chipsActivos", () => {
  const rango = { min: 120, max: 50000 };

  it("sin filtros no hay chips", () => {
    expect(chipsActivos(base, rango)).toEqual([]);
  });

  it("orden categorías → marcas → precio → stock, cada uno con su forma de quitarse", () => {
    const estado: EstadoCatalogo = {
      ...base,
      categorias: ["ILUMINACION"],
      marcas: ["GENROD", "MACROLED"],
      precioMin: 500,
      soloStock: true,
    };
    const chips = chipsActivos(estado, rango).map((c) => ({
      ...c,
      etiqueta: sinEspaciosRaros(c.etiqueta),
      removeLabel: sinEspaciosRaros(c.removeLabel),
    }));

    expect(chips.map((c) => c.etiqueta)).toEqual([
      "Iluminación",
      "Marca: GENROD",
      "Marca: MACROLED",
      "Precio: $ 500 – $ 50.000",
      "En stock",
    ]);
    expect(chips[1].removeLabel).toBe("Quitar filtro Marca: GENROD");
    expect(chips[0].cambios).toEqual({ categorias: [] });
    expect(chips[1].cambios).toEqual({ marcas: ["MACROLED"] });
    expect(chips[3].cambios).toEqual({ precioMin: undefined, precioMax: undefined });
    expect(chips[4].cambios).toEqual({ soloStock: false });
  });

  it("las claves son únicas (sirven de key de React)", () => {
    const chips = chipsActivos(
      { ...base, categorias: ["X"], marcas: ["X"], precioMax: 900 },
      rango
    );
    expect(new Set(chips.map((c) => c.clave)).size).toBe(chips.length);
  });

  it("sin rango real, el precio se muestra con lo que trae la URL", () => {
    const [chip] = chipsActivos({ ...base, precioMin: 500 }, null);
    expect(sinEspaciosRaros(chip.etiqueta)).toBe("Precio: desde $ 500");
    const [otro] = chipsActivos({ ...base, precioMax: 900 }, null);
    expect(sinEspaciosRaros(otro.etiqueta)).toBe("Precio: hasta $ 900");
  });
});

describe("limpiarFiltros / hayFiltros / contarFiltrosActivos", () => {
  it("limpiar borra filtros y conserva búsqueda, orden y vista (no los toca)", () => {
    expect(limpiarFiltros()).toEqual({
      categorias: [],
      marcas: [],
      precioMin: undefined,
      precioMax: undefined,
      soloStock: false,
    });
  });

  it("hayFiltros mira categorías, marcas, precio y stock; no la búsqueda", () => {
    expect(hayFiltros(base)).toBe(false);
    expect(hayFiltros({ ...base, query: "led", orden: "precio-asc", vista: "lista" })).toBe(false);
    expect(hayFiltros({ ...base, marcas: ["X"] })).toBe(true);
    expect(hayFiltros({ ...base, precioMax: 10 })).toBe(true);
    expect(hayFiltros({ ...base, soloStock: true })).toBe(true);
  });

  it("cuenta cada categoría y marca, el precio como uno y el stock como uno", () => {
    expect(
      contarFiltrosActivos({
        ...base,
        categorias: ["ILUMINACION"],
        marcas: ["GENROD", "MACROLED"],
        precioMin: 500,
        precioMax: 900,
        soloStock: true,
      })
    ).toBe(5);
    expect(contarFiltrosActivos(base)).toBe(0);
  });
});

describe("indexable", () => {
  it("indexan /catalogo, una categoría y sus páginas", () => {
    expect(indexable(base)).toBe(true);
    expect(indexable({ ...base, categorias: ["ILUMINACION"], pagina: 3 })).toBe(true);
  });

  it("cualquier otra combinación queda noindex", () => {
    expect(indexable({ ...base, query: "led" })).toBe(false);
    expect(indexable({ ...base, marcas: ["X"] })).toBe(false);
    expect(indexable({ ...base, precioMin: 500 })).toBe(false);
    expect(indexable({ ...base, precioMax: 500 })).toBe(false);
    expect(indexable({ ...base, soloStock: true })).toBe(false);
    expect(indexable({ ...base, orden: "precio-asc" })).toBe(false);
    expect(indexable({ ...base, vista: "lista" })).toBe(false);
    expect(indexable({ ...base, categorias: ["A", "B"] })).toBe(false);
  });
});

describe("itemsDeFaceta", () => {
  const facetas = [
    { label: "ELECTRICIDAD", count: 3385 },
    { label: "HERRAMIENTAS", count: 12 },
  ];

  it("marca como tildados los valores del estado", () => {
    const items = itemsDeFaceta(facetas, ["HERRAMIENTAS"]);
    expect(items).toEqual([
      { label: "ELECTRICIDAD", count: 3385, checked: false },
      { label: "HERRAMIENTAS", count: 12, checked: true },
    ]);
  });

  it("un valor tildado que la faceta no trae aparece igual, primero y con cuenta 0", () => {
    // Iluminación + una marca que no tiene productos de iluminación: la
    // faceta de categorías ya no trae ILUMINACION, pero sigue tildada.
    const items = itemsDeFaceta(facetas, ["ILUMINACION"]);
    expect(items[0]).toEqual({ label: "ILUMINACION", count: 0, checked: true });
    expect(items).toHaveLength(3);
  });

  it("no duplica un tildado que la faceta sí trae", () => {
    const items = itemsDeFaceta(facetas, ["ELECTRICIDAD"]);
    expect(items.filter((i) => i.label === "ELECTRICIDAD")).toHaveLength(1);
  });
});

describe("etiquetaBotonFiltros", () => {
  it("scenario MOB-1: con filtros activos lleva el conteo", () => {
    expect(etiquetaBotonFiltros(5)).toBe("Filtros (5)");
  });

  it("sin filtros es sólo \"Filtros\"", () => {
    expect(etiquetaBotonFiltros(0)).toBe("Filtros");
  });
});
