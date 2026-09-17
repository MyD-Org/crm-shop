import { describe, expect, it } from "vitest";
import {
  comoLista,
  comoOrden,
  comoPagina,
  hrefCatalogo,
  hrefCon,
  leerEstado,
  paginasVisibles,
  type EstadoCatalogo,
} from "./catalogo-url";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  orden: "ventas",
  pagina: 1,
};

describe("lectura de la query string", () => {
  it("un parámetro repetible llega como string o como array", () => {
    expect(comoLista("Iluminación")).toEqual(["Iluminación"]);
    expect(comoLista(["Iluminación", "Cables"])).toEqual(["Iluminación", "Cables"]);
    expect(comoLista(undefined)).toEqual([]);
  });

  it("descarta vacíos y duplicados", () => {
    expect(comoLista(["Philips", "  ", "Philips", " Osram "])).toEqual([
      "Philips",
      "Osram",
    ]);
  });

  it("una página inválida o menor a 1 cae en la 1", () => {
    expect(comoPagina("3")).toBe(3);
    expect(comoPagina("0")).toBe(1);
    expect(comoPagina("-4")).toBe(1);
    expect(comoPagina("hola")).toBe(1);
    expect(comoPagina(undefined)).toBe(1);
  });

  it("un orden que no existe cae en el default", () => {
    expect(comoOrden("precio-desc")).toBe("precio-desc");
    expect(comoOrden("drop-table")).toBe("ventas");
    expect(comoOrden(undefined)).toBe("ventas");
  });

  it("arma el estado completo desde searchParams", () => {
    expect(
      leerEstado({
        q: "  led  ",
        categoria: "Iluminación",
        marca: ["Philips", "Osram"],
        orden: "nombre",
        pagina: "2",
      })
    ).toEqual({
      query: "led",
      categorias: ["Iluminación"],
      marcas: ["Philips", "Osram"],
      orden: "nombre",
      pagina: 2,
    });
  });

  it("una búsqueda en blanco es como no buscar", () => {
    expect(leerEstado({ q: "   " }).query).toBeUndefined();
  });
});

describe("armado de URLs", () => {
  it("el estado por defecto es /catalogo pelado", () => {
    expect(hrefCatalogo(base)).toBe("/catalogo");
  });

  it("repite el parámetro por cada categoría y marca", () => {
    expect(
      hrefCatalogo({ ...base, categorias: ["Cables"], marcas: ["Philips", "Osram"] })
    ).toBe("/catalogo?categoria=Cables&marca=Philips&marca=Osram");
  });

  it("no escribe el orden ni la página cuando están en su default", () => {
    expect(hrefCatalogo({ ...base, orden: "ventas", pagina: 1 })).toBe("/catalogo");
    expect(hrefCatalogo({ ...base, orden: "precio-asc", pagina: 3 })).toBe(
      "/catalogo?orden=precio-asc&pagina=3"
    );
  });

  it("conserva la búsqueda al cambiar de página", () => {
    expect(hrefCon({ ...base, query: "led" }, { pagina: 4 })).toBe(
      "/catalogo?q=led&pagina=4"
    );
  });

  it("cualquier cambio que no sea de página vuelve a la 1", () => {
    // Estando en la página 7, tildar una marca no puede dejarte en una página
    // 7 que en el resultado nuevo quizá no exista.
    expect(hrefCon({ ...base, pagina: 7 }, { marcas: ["Philips"] })).toBe(
      "/catalogo?marca=Philips"
    );
    expect(hrefCon({ ...base, pagina: 7 }, { orden: "nombre" })).toBe(
      "/catalogo?orden=nombre"
    );
  });
});

describe("paginasVisibles", () => {
  it("hasta 7 páginas las muestra todas, sin elipsis", () => {
    expect(paginasVisibles(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginasVisibles(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("al principio, elipsis sólo del lado derecho", () => {
    expect(paginasVisibles(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(paginasVisibles(2, 20)).toEqual([1, 2, 3, 4, null, 20]);
  });

  it("en el medio, elipsis de los dos lados", () => {
    expect(paginasVisibles(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  });

  it("al final, elipsis sólo del lado izquierdo", () => {
    expect(paginasVisibles(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });

  it("siempre incluye la primera, la última y la actual", () => {
    for (const actual of [1, 2, 8, 57, 117]) {
      const vistas = paginasVisibles(actual, 117);
      expect(vistas).toContain(1);
      expect(vistas).toContain(117);
      expect(vistas).toContain(actual);
    }
  });
});
