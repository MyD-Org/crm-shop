import { describe, expect, it } from "vitest";
import type { EstadoCatalogo } from "./catalogo-url";
import { sinResultadosPorCategoria, sinResultadosPorLocal } from "./catalogo-sin-resultados";

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
const locales = [
  { slug: "mar-del-plata", nombre: "Mar del Plata" },
  { slug: "igz", nombre: "Iguazú" },
];

describe("sinResultadosPorLocal", () => {
  it("sin filtro de local no aplica", () => {
    expect(sinResultadosPorLocal(base, locales, "luz")).toBeNull();
  });

  it("con local y consulta, dice el local por su nombre y la consulta", () => {
    const r = sinResultadosPorLocal({ ...base, retiroEn: "mar-del-plata" }, locales, "luz");
    expect(r).toEqual({
      titulo: "No hay productos con stock en Mar del Plata para «luz»",
      descripcion: "Puede ver los productos de todos los locales.",
      accion: "Ver en todos los locales",
    });
  });

  it("navegando sin consulta, el título no la menciona", () => {
    const r = sinResultadosPorLocal({ ...base, retiroEn: "igz" }, locales, undefined);
    expect(r?.titulo).toBe("No hay productos con stock en Iguazú");
    expect(sinResultadosPorLocal({ ...base, retiroEn: "igz" }, locales, "  ")?.titulo).toBe(
      "No hay productos con stock en Iguazú",
    );
  });

  it("un local desconocido cae al slug", () => {
    const r = sinResultadosPorLocal({ ...base, retiroEn: "otro" }, locales, undefined);
    expect(r?.titulo).toBe("No hay productos con stock en otro");
  });
});

describe("sinResultadosPorCategoria", () => {
  it("sin búsqueda o sin categorías no aplica", () => {
    expect(sinResultadosPorCategoria({ ...base, categorias: ["HERRAMIENTAS"] }, undefined)).toBeNull();
    expect(sinResultadosPorCategoria(base, "Plafón 60x60")).toBeNull();
  });

  it("dice que el 0 es de la búsqueda en esa categoría y nombra las dos salidas", () => {
    expect(sinResultadosPorCategoria({ ...base, categorias: ["HERRAMIENTAS"] }, "Plafón 60x60")).toEqual({
      titulo: "No hay «Plafón 60x60» en Herramientas",
      descripcion: "Puede quitar la categoría para volver a la búsqueda, o ver todo lo que hay en ella.",
      quitar: "Quitar Herramientas",
      verSinBusqueda: "Ver todo en Herramientas",
    });
  });

  it("con varias categorías las nombra juntas", () => {
    const r = sinResultadosPorCategoria({ ...base, categorias: ["HERRAMIENTAS", "SEGURIDAD"] }, "plafón");
    expect(r?.titulo).toBe("No hay «plafón» en Herramientas o Seguridad");
  });
});
