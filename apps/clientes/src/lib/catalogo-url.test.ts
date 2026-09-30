import { describe, expect, it } from "vitest";
import {
  ORDENES,
  ORDEN_DEFAULT,
  SOLO_STOCK_DEFAULT,
  STOCK_INCLUYE_SIN_STOCK,
  IA_DESACTIVADA,
  cambiosDeRango,
  consultaInterpretada,
  sinBusquedaIa,
  comoLista,
  comoOrden,
  comoPagina,
  comoPrecio,
  estadoConCambios,
  estadoDeBusqueda,
  filtrosDesfasados,
  hrefCanonico,
  hrefCatalogo,
  hrefCon,
  filtrosDeEstado,
  leerEstado,
  rangoEfectivo,
  type EstadoCatalogo,
  type RangoPrecio,
} from "./catalogo-url";

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

  it("los órdenes ofrecidos son relevancia, nombre y precio; sin búsqueda el default es nombre", () => {
    expect(ORDENES).toEqual(["relevancia", "nombre", "precio-asc", "precio-desc"]);
    expect(ORDENES).not.toContain("ventas");
    expect(ORDEN_DEFAULT).toBe("nombre");
  });

  it("con búsqueda el default es relevancia; sin búsqueda, relevancia no vale", () => {
    expect(comoOrden(undefined, "led")).toBe("relevancia");
    expect(comoOrden("basura", "led")).toBe("relevancia");
    expect(comoOrden("ventas", "led")).toBe("relevancia");
    expect(comoOrden("nombre", "led")).toBe("nombre");
    expect(comoOrden("relevancia")).toBe("nombre");
    expect(leerEstado({ q: "led" }).orden).toBe("relevancia");
    expect(leerEstado({ q: "  ", orden: "relevancia" }).orden).toBe("nombre");
  });

  it("relevancia con búsqueda no viaja en la URL; nombre con búsqueda sí", () => {
    expect(hrefCatalogo({ ...base, query: "led", orden: "relevancia" })).toBe("/catalogo?q=led");
    expect(hrefCatalogo({ ...base, query: "led", orden: "nombre" })).toBe(
      "/catalogo?q=led&orden=nombre"
    );
  });

  it("quitar la búsqueda con orden relevancia vuelve al alfabético", () => {
    const conBusqueda = { ...base, query: "led", orden: "relevancia" as const };
    expect(estadoConCambios(conBusqueda, { query: undefined }).orden).toBe("nombre");
    expect(hrefCon(conBusqueda, { query: undefined })).toBe("/catalogo");
    // Un orden elegido a mano sobrevive.
    expect(hrefCon({ ...conBusqueda, orden: "precio-asc" }, { query: undefined })).toBe(
      "/catalogo?orden=precio-asc"
    );
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
        stock: STOCK_INCLUYE_SIN_STOCK,
        vista: "lista",
      })
    ).toEqual({
      query: "led",
      categorias: ["Iluminación"],
      marcas: ["Philips", "Osram"],
      atributos: [],
      orden: "precio-asc",
      pagina: 2,
      precioMin: 500,
      precioMax: 50000,
      soloStock: false,
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
    expect(estado.soloStock).toBe(SOLO_STOCK_DEFAULT);
    expect(estado.vista).toBe("grilla");
  });

  it("sólo con stock es el default: sin parámetro, el filtro está prendido", () => {
    expect(SOLO_STOCK_DEFAULT).toBe(true);
    expect(leerEstado({}).soloStock).toBe(true);
  });

  it("el filtro sólo se apaga con el valor explícito de incluir sin stock", () => {
    expect(STOCK_INCLUYE_SIN_STOCK).toBe("todos");
    expect(leerEstado({ stock: STOCK_INCLUYE_SIN_STOCK }).soloStock).toBe(false);
    expect(leerEstado({ stock: [STOCK_INCLUYE_SIN_STOCK, "1"] }).soloStock).toBe(false);
    expect(leerEstado({ stock: "0" }).soloStock).toBe(true);
    expect(leerEstado({ stock: "true" }).soloStock).toBe(true);
  });

  it("un link viejo con stock=1 sigue funcionando y se normaliza sin el parámetro", () => {
    const estado = leerEstado({ stock: "1", pagina: "2" });
    expect(estado.soloStock).toBe(true);
    expect(hrefCatalogo(estado)).toBe("/catalogo?pagina=2");
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
        atributos: [],
        precioMin: 500,
        precioMax: 50000,
        soloStock: false,
        orden: "precio-asc",
        vista: "lista",
        pagina: 2,
      })
    ).toBe(
      `/catalogo?categoria=ILUMINACION&marca=GENROD&precio_min=500&precio_max=50000&stock=${STOCK_INCLUYE_SIN_STOCK}&orden=precio-asc&vista=lista&pagina=2`
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
    expect(hrefCon({ ...base, query: "led", orden: "relevancia" }, { pagina: 4 })).toBe(
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
    expect(hrefCon({ ...base, pagina: 7 }, { soloStock: false })).toBe(
      `/catalogo?stock=${STOCK_INCLUYE_SIN_STOCK}`
    );
  });

  it("sólo con stock prendido (el default) no viaja en la URL", () => {
    expect(hrefCatalogo({ ...base, soloStock: true })).toBe("/catalogo");
    expect(hrefCon({ ...base, soloStock: false }, { soloStock: true })).toBe("/catalogo");
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

describe("estadoConCambios", () => {
  // Regresión: el panel de filtros de desktop armaba la URL con el
  // `estadoVisible` del último render, así que dos cambios seguidos antes de
  // que React renderizara de nuevo se pisaban (un filtro quedaba aplicado
  // "a veces sí, a veces no"). El fix es encadenar sobre el ESTADO
  // RESULTANTE del cambio anterior, no sobre el estado original.
  it("dos cambios encadenados se acumulan, no se pisan", () => {
    const trasElPrimero = estadoConCambios(base, { marcas: ["Philips"] });
    const trasElSegundo = estadoConCambios(trasElPrimero, { precioMin: 500 });
    expect(trasElSegundo.marcas).toEqual(["Philips"]);
    expect(trasElSegundo.precioMin).toBe(500);
  });

  it("encadenar sobre el estado ORIGINAL en vez del resultante pierde el primer cambio (lo que pasaba antes del fix)", () => {
    // Este test documenta el bug: si en vez de encadenar se recalculan los
    // dos cambios contra `base`, el segundo pisa al primero.
    const segundoContraElOriginal = estadoConCambios(base, { precioMin: 500 });
    expect(segundoContraElOriginal.marcas).toEqual([]);
  });

  it("todo cambio que no sea de página vuelve a la 1, igual que hrefCon", () => {
    expect(estadoConCambios({ ...base, pagina: 7 }, { marcas: ["Philips"] }).pagina).toBe(1);
    expect(estadoConCambios({ ...base, pagina: 7 }, { pagina: 3 }).pagina).toBe(3);
  });

  it("hrefCon usa estadoConCambios para armar la URL", () => {
    const estado = estadoConCambios(base, { marcas: ["Philips"] });
    expect(hrefCatalogo(estado)).toBe(hrefCon(base, { marcas: ["Philips"] }));
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

describe("hrefCanonico", () => {
  it("conserva la categoría y la página; descarta la vista", () => {
    expect(
      hrefCanonico({ ...base, categorias: ["ILUMINACION"], vista: "lista", pagina: 2 })
    ).toBe("/catalogo?categoria=ILUMINACION&pagina=2");
  });

  it("con varias categorías, sólo la primera", () => {
    expect(hrefCanonico({ ...base, categorias: ["A", "B"] })).toBe("/catalogo?categoria=A");
  });

  it("descarta búsqueda, marcas, precio, stock y orden", () => {
    expect(
      hrefCanonico({
        ...base,
        query: "led",
        marcas: ["GENROD"],
        precioMin: 500,
        precioMax: 900,
        soloStock: false,
        orden: "precio-desc",
      })
    ).toBe("/catalogo");
  });
});

describe("filtrosDeEstado", () => {
  it("sin parámetros, la consulta pide sólo productos con stock", () => {
    expect(filtrosDeEstado(leerEstado({})).soloStock).toBe(true);
  });

  it("con incluir sin stock, la consulta no filtra por stock", () => {
    expect(
      filtrosDeEstado(leerEstado({ stock: STOCK_INCLUYE_SIN_STOCK })).soloStock
    ).toBe(false);
  });

  it("pasa búsqueda, categorías, marcas y precio tal cual", () => {
    expect(
      filtrosDeEstado(
        leerEstado({
          q: "led",
          categoria: "ILUMINACION",
          marca: "GENROD",
          precio_min: "500",
          precio_max: "900",
        })
      )
    ).toEqual({
      busqueda: "led",
      categorias: ["ILUMINACION"],
      marcas: ["GENROD"],
      atributos: [],
      precioMin: 500,
      precioMax: 900,
      soloStock: true,
    });
  });
});

describe("URL del browser contra el estado que renderizó el servidor", () => {
  const sp = (qs: string) => new URLSearchParams(qs);

  it("lee la query string del browser con las mismas reglas que la page", () => {
    expect(
      estadoDeBusqueda(sp("q=led&categoria=Hogar&marca=KING&marca=AKAI&stock=todos&pagina=2"))
    ).toEqual({
      ...base,
      query: "led",
      orden: "relevancia",
      categorias: ["Hogar"],
      marcas: ["KING", "AKAI"],
      soloStock: false,
      pagina: 2,
    });
    expect(estadoDeBusqueda(sp(""))).toEqual(base);
  });

  it("una categoría con coma llega entera", () => {
    expect(estadoDeBusqueda(sp("categoria=Llaves%2C+tomas+y+accesorios")).categorias).toEqual([
      "Llaves, tomas y accesorios",
    ]);
  });

  // Next 16.2.9 arma la clave del segmento de la página con
  // Object.fromEntries(new URLSearchParams(search)): de un parámetro repetido
  // sólo queda el último valor. `marca=KING&marca=AKAI` y `marca=AKAI` dan la
  // misma clave, Next no pide datos nuevos y la página queda con los de antes.
  it("detecta la navegación en la que Next reusó la página vieja", () => {
    const renderizado = { ...base, marcas: ["KING", "AKAI"] };
    expect(filtrosDesfasados(renderizado, sp("marca=AKAI"))).toBe(true);
    expect(filtrosDesfasados(renderizado, sp("marca=TACOMA&marca=AKAI"))).toBe(true);
    expect(
      filtrosDesfasados({ ...base, categorias: ["Tubos", "Veladores"] }, sp("categoria=Veladores"))
    ).toBe(true);
  });

  it("no hay desfase cuando la URL y el render coinciden, sin importar el orden", () => {
    const renderizado = { ...base, categorias: ["Hogar"], marcas: ["KING", "AKAI"] };
    expect(filtrosDesfasados(renderizado, sp("categoria=Hogar&marca=KING&marca=AKAI"))).toBe(false);
    expect(filtrosDesfasados(renderizado, sp("categoria=Hogar&marca=AKAI&marca=KING"))).toBe(false);
    expect(filtrosDesfasados(base, sp(""))).toBe(false);
  });

  it("la página efectiva distinta de la pedida no es un desfase", () => {
    // La page manda la página recortada (URL dice 99, hay 12): eso no se
    // arregla pidiendo de nuevo.
    expect(filtrosDesfasados({ ...base, pagina: 12 }, sp("pagina=99"))).toBe(false);
  });
});

describe("atributos (`atr`) y búsqueda inteligente (`ia`)", () => {
  const sp = (qs: string) => new URLSearchParams(qs);
  it("lee `atr` repetible, descarta los ids desconocidos y ordena como el diccionario", () => {
    const e = leerEstado({ atr: ["zocalo-e27", "inventado", "tono-calido", "tono-calido"] });
    expect(e.atributos).toEqual(["tono-calido", "zocalo-e27"]);
    expect(leerEstado({}).atributos).toEqual([]);
  });

  it("ida y vuelta con `atr` e `ia` (orden estable de parámetros)", () => {
    const e = leerEstado({ q: "50w", categoria: "Reflectores", atr: ["apto-exterior", "tono-calido"], ia: "reflector calido para el patio 50w" });
    const href = hrefCatalogo(e);
    expect(href).toBe(
      "/catalogo?q=50w&categoria=Reflectores&atr=tono-calido&atr=apto-exterior&ia=reflector+calido+para+el+patio+50w",
    );
    expect(estadoDeBusqueda(new URLSearchParams(href.split("?")[1]))).toEqual(e);
  });

  it("`ia=0` es la búsqueda tal cual; la consulta interpretada es cualquier otro valor", () => {
    expect(consultaInterpretada(leerEstado({ ia: IA_DESACTIVADA }))).toBeUndefined();
    expect(consultaInterpretada(leerEstado({ ia: " luz para el patio " }))).toBe("luz para el patio");
    expect(consultaInterpretada(leerEstado({}))).toBeUndefined();
    expect(hrefCatalogo({ ...base, query: "reflector", orden: "relevancia", ia: IA_DESACTIVADA })).toBe("/catalogo?q=reflector&ia=0");
  });

  it("`q` se recorta a 200 caracteres", () => {
    expect(leerEstado({ q: "y".repeat(5000) }).query).toHaveLength(200);
  });

  it("`ia` se recorta a 120 caracteres", () => {
    expect(leerEstado({ ia: "x".repeat(300) }).ia).toHaveLength(120);
  });

  it("cambiar filtros o página conserva `ia`; cambiar la búsqueda lo quita", () => {
    const e = { ...base, atributos: ["tono-calido"], ia: "luz calida" };
    expect(estadoConCambios(e, { atributos: [] }).ia).toBe("luz calida");
    expect(estadoConCambios(e, { pagina: 2 }).ia).toBe("luz calida");
    expect(estadoConCambios(e, { query: "otra cosa" }).ia).toBeUndefined();
    expect(estadoConCambios(e, { query: "luz calida", ia: IA_DESACTIVADA }).ia).toBe(IA_DESACTIVADA);
  });

  it("el canonical no lleva atributos ni `ia`, y los filtros los pasan al SQL", () => {
    const e = { ...base, categorias: ["Reflectores"], atributos: ["tono-frio"], ia: "x" };
    expect(hrefCanonico(e)).toBe("/catalogo?categoria=Reflectores");
    expect(filtrosDeEstado(e).atributos).toEqual(["tono-frio"]);
  });

  it("un atributo destildado que Next no pidió de nuevo es un desfase", () => {
    const renderizado = { ...base, atributos: ["tono-calido", "zocalo-e27"] };
    expect(filtrosDesfasados(renderizado, sp("atr=zocalo-e27"))).toBe(true);
    expect(filtrosDesfasados(renderizado, sp("atr=zocalo-e27&atr=tono-calido"))).toBe(false);
  });
});

describe("flag busqueda-ia apagado", () => {
  const sp = (qs: string) => new URLSearchParams(qs);

  it("sinBusquedaIa: sin atributos ni ia, como el catálogo de siempre", () => {
    const e = leerEstado({ q: "reflector", categoria: "Reflectores", atr: "tono-calido", ia: "algo" });
    const apagado = sinBusquedaIa(e);
    expect(apagado.atributos).toEqual([]);
    expect(apagado).not.toHaveProperty("ia");
    expect(hrefCatalogo(apagado)).toBe("/catalogo?q=reflector&categoria=Reflectores");
  });

  it("los atributos de la URL no cuentan como desfase (si no, se pediría la página en bucle)", () => {
    const renderizado = sinBusquedaIa(leerEstado({ atr: "tono-calido" }));
    expect(filtrosDesfasados(renderizado, sp("atr=tono-calido"), false)).toBe(false);
    expect(filtrosDesfasados(renderizado, sp("atr=tono-calido"))).toBe(true);
  });
});
