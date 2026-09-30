import { describe, expect, it } from "vitest";
import {
  alternarCategoria,
  itemsDeFaceta,
  anuncioResultados,
  chipsActivos,
  contadorProductos,
  contarFiltrosActivos,
  etiquetaBotonFiltros,
  etiquetaStock,
  mostrarStockEnCard,
  fmtPesos,
  hayFiltros,
  indexable,
  limpiarFiltros,
  migas,
  textoUnidadesDisponibles,
  maxCantidad,
  CANTIDAD_MAXIMA,
  tituloCatalogo,
  interpretacionVigente,
} from "./catalogo-vista";
import type { EstadoCatalogo } from "./catalogo-url";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  atributos: [],
  orden: "nombre",
  pagina: 1,
  soloStock: true,
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
    expect(etiquetaStock({ stock: "low", stockQty: 3 })).toBe("Quedan 3");
    expect(etiquetaStock({ stock: "low", stockQty: 1 })).toBe("Queda 1");
  });

  it("en cualquier otro caso deja el texto por defecto del DS", () => {
    expect(etiquetaStock({ stock: "low" })).toBeUndefined();
    expect(etiquetaStock({ stock: "in", stockQty: 40 })).toBeUndefined();
    expect(etiquetaStock({ stock: "out", stockQty: 0 })).toBeUndefined();
  });

  it("nunca dice Quedan n con n menor o igual a cero", () => {
    expect(etiquetaStock({ stock: "low", stockQty: 0 })).toBeUndefined();
    expect(etiquetaStock({ stock: "low", stockQty: -2 })).toBeUndefined();
  });
});

describe("mostrarStockEnCard", () => {
  it("sólo las excepciones: pocas unidades o sin stock", () => {
    expect(mostrarStockEnCard({ stock: "in" })).toBe(false);
    expect(mostrarStockEnCard({ stock: "low" })).toBe(true);
    expect(mostrarStockEnCard({ stock: "out" })).toBe(true);
  });
});

describe("textoUnidadesDisponibles", () => {
  it("con cantidad positiva conocida, la muestra", () => {
    expect(textoUnidadesDisponibles({ stock: "in", stockQty: 40 })).toBe("40 disponibles");
    expect(textoUnidadesDisponibles({ stock: "low", stockQty: 3 })).toBe("3 disponibles");
    expect(textoUnidadesDisponibles({ stock: "low", stockQty: 1 })).toBe("1 disponible");
  });

  it("disponible con cantidad cero o negativa no muestra la cantidad", () => {
    expect(textoUnidadesDisponibles({ stock: "in", stockQty: 0 })).toBeUndefined();
    expect(textoUnidadesDisponibles({ stock: "in", stockQty: -5 })).toBeUndefined();
  });

  it("sin stock o sin cantidad conocida no muestra nada", () => {
    expect(textoUnidadesDisponibles({ stock: "out", stockQty: 0 })).toBeUndefined();
    expect(textoUnidadesDisponibles({ stock: "in" })).toBeUndefined();
  });
});

describe("maxCantidad", () => {
  it("con cantidad conocida, no deja pasar de las disponibles", () => {
    expect(maxCantidad({ stock: "low", stockQty: 1 })).toBe(1);
    expect(maxCantidad({ stock: "in", stockQty: 40 })).toBe(40);
  });

  it("sin cantidad (no inventariable) usa el tope general", () => {
    expect(maxCantidad({ stock: "in" })).toBe(CANTIDAD_MAXIMA);
  });
});

describe("fmtPesos", () => {
  it("pesos argentinos sin decimales", () => {
    expect(sinEspaciosRaros(fmtPesos(50000))).toBe("$ 50.000");
  });
});

describe("chipsActivos", () => {
  const rango = { min: 120, max: 50000 };

  it("sin filtros no hay chips (sólo con stock es el default y no se muestra)", () => {
    expect(chipsActivos(base, rango)).toEqual([]);
  });

  it("orden categorías → marcas → precio → stock, cada uno con su forma de quitarse", () => {
    const estado: EstadoCatalogo = {
      ...base,
      categorias: ["ILUMINACION"],
      marcas: ["GENROD", "MACROLED"],
      precioMin: 500,
      soloStock: false,
    };
    const chips = chipsActivos(estado, rango).map((c) => ({
      ...c,
      etiqueta: sinEspaciosRaros(c.etiqueta),
      removeLabel: sinEspaciosRaros(c.removeLabel),
    }));

    expect(chips.map((c) => c.etiqueta)).toEqual([
      "Iluminación",
      "Marca: Genrod",
      "Marca: Macroled",
      "Precio: $ 500 – $ 50.000",
      "Incluye sin stock",
    ]);
    expect(chips[1].removeLabel).toBe("Quitar filtro Marca: Genrod");
    expect(chips[0].cambios).toEqual({ categorias: [] });
    expect(chips[1].cambios).toEqual({ marcas: ["MACROLED"] });
    expect(chips[3].cambios).toEqual({ precioMin: undefined, precioMax: undefined });
    expect(chips[4].removeLabel).toBe("Quitar filtro Incluye sin stock");
    expect(chips[4].cambios).toEqual({ soloStock: true });
  });

  it("los atributos van después de las marcas, con su nombre visible", () => {
    const chips = chipsActivos({ ...base, marcas: ["GENROD"], atributos: ["tono-calido", "apto-exterior"] }, rango);
    expect(chips.map((c) => c.etiqueta)).toEqual(["Marca: Genrod", "Luz cálida", "Apto exterior"]);
    expect(chips[1].cambios).toEqual({ atributos: ["apto-exterior"] });
    expect(chips[1].removeLabel).toBe("Quitar filtro Luz cálida");
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
      atributos: [],
      precioMin: undefined,
      precioMax: undefined,
      soloStock: true,
    });
  });

  it("hayFiltros mira categorías, marcas, precio y stock; no la búsqueda", () => {
    expect(hayFiltros(base)).toBe(false);
    expect(hayFiltros({ ...base, query: "led", orden: "precio-asc", vista: "lista" })).toBe(false);
    expect(hayFiltros({ ...base, marcas: ["X"] })).toBe(true);
    expect(hayFiltros({ ...base, precioMax: 10 })).toBe(true);
    expect(hayFiltros({ ...base, soloStock: true })).toBe(false);
    expect(hayFiltros({ ...base, soloStock: false })).toBe(true);
  });

  it("cuenta cada categoría y marca, el precio como uno y el stock como uno", () => {
    expect(
      contarFiltrosActivos({
        ...base,
        categorias: ["ILUMINACION"],
        marcas: ["GENROD", "MACROLED"],
        precioMin: 500,
        precioMax: 900,
        soloStock: false,
      })
    ).toBe(5);
    expect(contarFiltrosActivos(base)).toBe(0);
    expect(contarFiltrosActivos({ ...base, atributos: ["tono-frio", "zocalo-e27"] })).toBe(2);
    expect(contarFiltrosActivos({ ...base, soloStock: true })).toBe(0);
  });
});

describe("indexable", () => {
  it("indexan /catalogo, una categoría y sus páginas", () => {
    expect(indexable(base)).toBe(true);
    expect(indexable({ ...base, soloStock: true })).toBe(true);
    expect(indexable({ ...base, categorias: ["ILUMINACION"], pagina: 3 })).toBe(true);
  });

  it("cualquier otra combinación queda noindex", () => {
    expect(indexable({ ...base, query: "led" })).toBe(false);
    expect(indexable({ ...base, marcas: ["X"] })).toBe(false);
    expect(indexable({ ...base, precioMin: 500 })).toBe(false);
    expect(indexable({ ...base, precioMax: 500 })).toBe(false);
    expect(indexable({ ...base, soloStock: false })).toBe(false);
    expect(indexable({ ...base, orden: "precio-asc" })).toBe(false);
    expect(indexable({ ...base, vista: "lista" })).toBe(false);
    expect(indexable({ ...base, categorias: ["A", "B"] })).toBe(false);
    expect(indexable({ ...base, atributos: ["tono-calido"] })).toBe(false);
    expect(indexable({ ...base, categorias: ["Reflectores"], ia: "reflector para el patio" })).toBe(false);
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

describe("alternarCategoria", () => {
  const facetas = [
    { label: "Electricidad", nivel: 1 },
    { label: "Iluminación", nivel: 1 },
    { label: "Focos led", nivel: 2 },
    { label: "Dicroicas", nivel: 3 },
    { label: "Paneles", nivel: 2 },
    { label: "Seguridad", nivel: 1 },
  ];

  it("destildar una hija cubierta saca a la madre y deja tildadas las hermanas", () => {
    expect(alternarCategoria(facetas, ["Iluminación", "Seguridad"], "Paneles", false)).toEqual([
      "Seguridad",
      "Focos led",
    ]);
  });

  it("destildar una nieta cubierta deja las hermanas de cada nivel del camino", () => {
    const arbol = [
      { label: "Iluminación", nivel: 1 },
      { label: "Focos led", nivel: 2 },
      { label: "Dicroicas", nivel: 3 },
      { label: "Bulbos", nivel: 3 },
      { label: "Paneles", nivel: 2 },
    ];
    expect(alternarCategoria(arbol, ["Iluminación"], "Dicroicas", false)).toEqual(["Paneles", "Bulbos"]);
  });

  it("destildar algo que no está ni cubierto no cambia nada", () => {
    expect(alternarCategoria(facetas, ["Seguridad"], "Paneles", false)).toEqual(["Seguridad"]);
  });

  it("tildar una madre saca a sus hijas y nietas, y deja lo de otras ramas", () => {
    expect(
      alternarCategoria(facetas, ["Dicroicas", "Paneles", "Seguridad"], "Iluminación", true),
    ).toEqual(["Seguridad", "Iluminación"]);
  });

  it("tildar una hoja sólo la agrega", () => {
    expect(alternarCategoria(facetas, ["Electricidad"], "Paneles", true)).toEqual([
      "Electricidad",
      "Paneles",
    ]);
  });

  it("destildar la saca", () => {
    expect(alternarCategoria(facetas, ["Iluminación", "Seguridad"], "Iluminación", false)).toEqual([
      "Seguridad",
    ]);
  });

  it("sin árbol (categorías planas, sin nivel) se comporta como una lista común", () => {
    const planas = [{ label: "A" }, { label: "B" }];
    expect(alternarCategoria(planas, ["A"], "B", true)).toEqual(["A", "B"]);
  });
});

describe("búsqueda interpretada (`ia`)", () => {
  it("el título y las migas hablan de lo que escribió el visitante", () => {
    const e = { ...base, categorias: ["Reflectores"], atributos: ["apto-exterior"], ia: "luz para el patio" };
    expect(interpretacionVigente(e)).toBe("luz para el patio");
    expect(tituloCatalogo(e)).toBe('Resultados para "luz para el patio"');
    expect(migas(e).at(-1)).toEqual({ label: "Resultados" });
  });

  it("sin nada de lo interpretado (o con `ia=0`) deja de ser una interpretación", () => {
    expect(interpretacionVigente({ ...base, ia: "luz para el patio" })).toBeUndefined();
    expect(interpretacionVigente({ ...base, query: "reflector", ia: "0" })).toBeUndefined();
    expect(tituloCatalogo({ ...base, query: "reflector", ia: "0" })).toBe('Resultados para "reflector"');
  });
});

describe("potencia en chips, contador, limpiar e indexable (fase 2)", () => {
  it("chip con el rango y cambio que lo quita", () => {
    const chips = chipsActivos({ ...base, potenciaMin: 10, potenciaMax: 50 }, null);
    expect(chips).toContainEqual(
      expect.objectContaining({ clave: "potencia", etiqueta: "Potencia: 10 – 50 W", cambios: { potenciaMin: undefined, potenciaMax: undefined } }),
    );
    expect(chipsActivos({ ...base, potenciaMin: 100 }, null).find((c) => c.clave === "potencia")?.etiqueta).toBe("Potencia: desde 100 W");
    expect(chipsActivos({ ...base, potenciaMax: 9 }, null).find((c) => c.clave === "potencia")?.etiqueta).toBe("Potencia: hasta 9 W");
  });

  it("cuenta como filtro, limpiar la quita y no es indexable", () => {
    expect(contarFiltrosActivos({ ...base, potenciaMin: 10 })).toBe(1);
    expect(limpiarFiltros()).toHaveProperty("potenciaMin", undefined);
    expect(limpiarFiltros()).toHaveProperty("potenciaMax", undefined);
    expect(indexable({ ...base, potenciaMax: 50 })).toBe(false);
  });
});
