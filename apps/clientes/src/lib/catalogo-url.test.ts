import { describe, expect, it } from "vitest";
import {
  ORDENES,
  ORDEN_DEFAULT,
  cambiosDeRango,
  comoLista,
  comoOrden,
  comoPagina,
  comoPrecio,
  hrefCatalogo,
  hrefCon,
  leerEstado,
  rangoEfectivo,
  type EstadoCatalogo,
  type RangoPrecio,
} from "./catalogo-url";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  orden: "nombre",
  pagina: 1,
  soloStock: false,
  vista: "grilla",
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

  it("los órdenes ofrecidos son nombre y precio; el default es nombre", () => {
    expect(ORDENES).toEqual(["nombre", "precio-asc", "precio-desc"]);
    expect(ORDENES).not.toContain("ventas");
    expect(ORDEN_DEFAULT).toBe("nombre");
  });

  it("un orden que no existe cae en el default", () => {
    expect(comoOrden("precio-desc")).toBe("precio-desc");
    expect(comoOrden("precio-asc")).toBe("precio-asc");
    expect(comoOrden("drop-table")).toBe("nombre");
    expect(comoOrden(undefined)).toBe("nombre");
  });

  it('"ventas" (links viejos) se acepta como alias del default', () => {
    expect(comoOrden("ventas")).toBe("nombre");
  });

  it("un precio de la URL es un entero no negativo; cualquier otra cosa no es precio", () => {
    expect(comoPrecio("500")).toBe(500);
    expect(comoPrecio("12.9")).toBe(12);
    expect(comoPrecio("0")).toBe(0);
    expect(comoPrecio("-1")).toBeUndefined();
    expect(comoPrecio("abc")).toBeUndefined();
    expect(comoPrecio("99,5")).toBeUndefined();
    expect(comoPrecio("")).toBeUndefined();
    expect(comoPrecio("   ")).toBeUndefined();
    expect(comoPrecio(undefined)).toBeUndefined();
    // Parámetro repetido: vale el primero.
    expect(comoPrecio(["12.9", "40"])).toBe(12);
  });

  it("arma el estado completo desde searchParams", () => {
    expect(
      leerEstado({
        q: "  led  ",
        categoria: "Iluminación",
        marca: ["Philips", "Osram"],
        orden: "precio-asc",
        pagina: "2",
        precio_min: "500",
        precio_max: "50000",
        stock: "1",
        vista: "lista",
      })
    ).toEqual({
      query: "led",
      categorias: ["Iluminación"],
      marcas: ["Philips", "Osram"],
      orden: "precio-asc",
      pagina: 2,
      precioMin: 500,
      precioMax: 50000,
      soloStock: true,
      vista: "lista",
    });
  });

  it("sin parámetros, el estado es el default", () => {
    expect(leerEstado({})).toEqual(base);
  });

  it("valores inválidos de precio, stock y vista caen al default sin romper", () => {
    const estado = leerEstado({
      precio_min: "abc",
      precio_max: "-3",
      stock: "si",
      vista: "mosaico",
    });
    expect(estado.precioMin).toBeUndefined();
    expect(estado.precioMax).toBeUndefined();
    expect(estado.soloStock).toBe(false);
    expect(estado.vista).toBe("grilla");
  });

  it("stock sólo se activa con exactamente 1", () => {
    expect(leerEstado({ stock: "1" }).soloStock).toBe(true);
    expect(leerEstado({ stock: "0" }).soloStock).toBe(false);
    expect(leerEstado({ stock: "true" }).soloStock).toBe(false);
    expect(leerEstado({ stock: ["1", "0"] }).soloStock).toBe(true);
  });

  it("vista sólo es lista con exactamente lista", () => {
    expect(leerEstado({ vista: "lista" }).vista).toBe("lista");
    expect(leerEstado({ vista: "grid" }).vista).toBe("grilla");
    expect(leerEstado({ vista: "grilla" }).vista).toBe("grilla");
  });

  it("decimales y parámetros repetidos: primer valor, truncado", () => {
    const estado = leerEstado({ precio_min: ["12.9", "40"], precio_max: "99,5" });
    expect(estado.precioMin).toBe(12);
    expect(estado.precioMax).toBeUndefined();
  });

  it("un rango invertido se intercambia: la intención es un rango", () => {
    const estado = leerEstado({ precio_min: "9000", precio_max: "100" });
    expect(estado.precioMin).toBe(100);
    expect(estado.precioMax).toBe(9000);
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
    expect(hrefCatalogo({ ...base, orden: "nombre", pagina: 1 })).toBe("/catalogo");
    expect(hrefCatalogo({ ...base, orden: "precio-asc", pagina: 3 })).toBe(
      "/catalogo?orden=precio-asc&pagina=3"
    );
  });

  it("el estado completo se escribe en un orden estable de parámetros", () => {
    expect(
      hrefCatalogo({
        query: undefined,
        categorias: ["ILUMINACION"],
        marcas: ["GENROD"],
        precioMin: 500,
        precioMax: 50000,
        soloStock: true,
        orden: "precio-asc",
        vista: "lista",
        pagina: 2,
      })
    ).toBe(
      "/catalogo?categoria=ILUMINACION&marca=GENROD&precio_min=500&precio_max=50000&stock=1&orden=precio-asc&vista=lista&pagina=2"
    );
  });

  it("escribe sólo el extremo de precio que está definido", () => {
    expect(hrefCatalogo({ ...base, precioMin: 500 })).toBe("/catalogo?precio_min=500");
    expect(hrefCatalogo({ ...base, precioMax: 9000 })).toBe("/catalogo?precio_max=9000");
  });

  it("un link viejo con orden=ventas se reescribe sin el orden", () => {
    const estado = leerEstado({ orden: "ventas", pagina: "3" });
    expect(estado.orden).toBe("nombre");
    expect(hrefCatalogo(estado)).toBe("/catalogo?pagina=3");
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
    expect(hrefCon({ ...base, pagina: 7 }, { orden: "precio-asc" })).toBe(
      "/catalogo?orden=precio-asc"
    );
    expect(hrefCon({ ...base, pagina: 7 }, { soloStock: true })).toBe(
      "/catalogo?stock=1"
    );
  });

  it("cambiar de vista conserva la página si el llamador la pasa explícita", () => {
    const estado = { ...base, pagina: 7 };
    expect(hrefCon(estado, { vista: "lista", pagina: estado.pagina })).toBe(
      "/catalogo?vista=lista&pagina=7"
    );
  });

  it("un cambio con undefined borra el parámetro", () => {
    expect(
      hrefCon({ ...base, precioMin: 500, precioMax: 9000 }, { precioMin: undefined })
    ).toBe("/catalogo?precio_max=9000");
  });
});

describe("rango de precio efectivo", () => {
  const rango: RangoPrecio = { min: 120, max: 80000 };

  it("sin extremos en la URL, el slider está en los límites reales", () => {
    expect(rangoEfectivo({}, rango)).toEqual([120, 80000]);
  });

  it("un extremo de la URL reemplaza al límite real", () => {
    expect(rangoEfectivo({ precioMin: 500 }, rango)).toEqual([500, 80000]);
    expect(rangoEfectivo({ precioMax: 9000 }, rango)).toEqual([120, 9000]);
  });

  it("valores fuera del rango real se recortan a él", () => {
    expect(rangoEfectivo({ precioMin: 1, precioMax: 999999 }, rango)).toEqual([
      120, 80000,
    ]);
  });

  it("sin rango real, no hay nada que mostrar", () => {
    expect(rangoEfectivo({ precioMin: 500 }, null)).toEqual([0, 0]);
  });

  it("un valor comprometido en el límite real no viaja en la URL", () => {
    expect(cambiosDeRango([120, 80000], rango)).toEqual({
      precioMin: undefined,
      precioMax: undefined,
    });
    expect(cambiosDeRango([500, 80000], rango)).toEqual({
      precioMin: 500,
      precioMax: undefined,
    });
    expect(cambiosDeRango([500, 9000], rango)).toEqual({
      precioMin: 500,
      precioMax: 9000,
    });
  });

  it("sin rango real, cambiar el rango equivale a no filtrar", () => {
    expect(cambiosDeRango([500, 9000], null)).toEqual({
      precioMin: undefined,
      precioMax: undefined,
    });
  });
});
