import { describe, expect, it } from "vitest";
import { estadoDeFiltros, hrefDeFiltros, idProductoDeRuta, puedeNavegarSolo } from "./chat-ia-integracion";

describe("filtros del agente → URL del catálogo", () => {
  it("mapea todos los campos con las reglas de catalogo-url", () => {
    expect(
      hrefDeFiltros({
        q: "50w",
        categories: ["Reflectores"],
        brands: ["GENROD"],
        attributes: ["tono-calido", "apto-exterior"],
        price_min: 1000,
        price_max: 50000,
        sort: "precio-asc",
        in_stock_only: false,
      }),
    ).toBe(
      "/catalogo?q=50w&categoria=Reflectores&marca=GENROD&atr=tono-calido&atr=apto-exterior&precio_min=1000&precio_max=50000&stock=todos&orden=precio-asc",
    );
  });

  it("descarta lo inválido: atributos desconocidos, precios negativos, orden raro", () => {
    expect(
      hrefDeFiltros({
        attributes: ["tono-violeta", "zocalo-e27"],
        price_min: -5,
        sort: "cualquiera" as never,
      }),
    ).toBe("/catalogo?atr=zocalo-e27");
  });

  it("sin filtros, el catálogo; in_stock_only true o ausente es el default", () => {
    expect(hrefDeFiltros({})).toBe("/catalogo");
    expect(hrefDeFiltros({ in_stock_only: true })).toBe("/catalogo");
    expect(estadoDeFiltros({ q: "reflector" }).orden).toBe("relevancia");
  });

  it("rango invertido se da vuelta", () => {
    expect(hrefDeFiltros({ price_min: 9000, price_max: 100 })).toBe("/catalogo?precio_min=100&precio_max=9000");
  });
});

describe("puedeNavegarSolo", () => {
  it("sólo en /catalogo, con el chat acoplado y abierto", () => {
    expect(puedeNavegarSolo({ pathname: "/catalogo", acoplado: true, abierto: true })).toBe(true);
    expect(puedeNavegarSolo({ pathname: "/catalogo/", acoplado: true, abierto: true })).toBe(true);
    expect(puedeNavegarSolo({ pathname: "/catalogo", acoplado: false, abierto: true })).toBe(false);
    expect(puedeNavegarSolo({ pathname: "/catalogo", acoplado: true, abierto: false })).toBe(false);
    expect(puedeNavegarSolo({ pathname: "/producto/1", acoplado: true, abierto: true })).toBe(false);
  });
});

describe("idProductoDeRuta", () => {
  it("el id de la ficha, decodificado", () => {
    expect(idProductoDeRuta("/producto/1101")).toBe("1101");
    expect(idProductoDeRuta("/producto/11%2001/")).toBe("11 01");
    expect(idProductoDeRuta("/catalogo")).toBeUndefined();
    expect(idProductoDeRuta("/producto/1/otra")).toBeUndefined();
  });
});
