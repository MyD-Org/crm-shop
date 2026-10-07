import { describe, expect, it } from "vitest";
import {
  comoDeshacer,
  estadoDeFiltros,
  hrefDeFiltros,
  idProductoDeRuta,
  mismaUrlCatalogo,
  puedeNavegarSolo,
  BREAKPOINT_MOBILE,
  MEDIA_MOBILE,
  hojaMinimizada,
} from "./chat-ia-integracion";

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
        attributes: ["tono-fucsia", "zocalo-e27"],
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

  it("en la hoja mobile abierta (expandida o minimizada) también, sólo en /catalogo", () => {
    expect(puedeNavegarSolo({ pathname: "/catalogo", acoplado: false, abierto: true, mobile: true })).toBe(true);
    expect(puedeNavegarSolo({ pathname: "/catalogo", acoplado: false, abierto: false, mobile: true })).toBe(false);
    expect(puedeNavegarSolo({ pathname: "/", acoplado: false, abierto: true, mobile: true })).toBe(false);
    // Entre 768 y 1279 px: drawer flotante, tapa la grilla.
    expect(puedeNavegarSolo({ pathname: "/catalogo", acoplado: false, abierto: true, mobile: false })).toBe(false);
  });
});

describe("hoja mobile", () => {
  it("la media query es la del widget (max-width: breakpoint - 0.02)", () => {
    expect(BREAKPOINT_MOBILE).toBe(768);
    expect(MEDIA_MOBILE).toBe("(max-width: 767.98px)");
  });

  it("minimizada sólo en mobile, abierta y en peek", () => {
    expect(hojaMinimizada({ mobile: true, abierto: true, presentacion: "peek" })).toBe(true);
    expect(hojaMinimizada({ mobile: true, abierto: true, presentacion: "expanded" })).toBe(false);
    expect(hojaMinimizada({ mobile: true, abierto: false, presentacion: "peek" })).toBe(false);
    expect(hojaMinimizada({ mobile: false, abierto: true, presentacion: "peek" })).toBe(false);
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

describe("deshacer la navegación del agente", () => {
  const destino = "/catalogo?categoria=Reflectores&atr=tono-calido";

  it("sigue en la página a la que navegó el agente ⇒ atrás en el historial", () => {
    expect(comoDeshacer(destino, destino)).toBe("atras");
    // El mismo estado con otro orden o codificación de parámetros es la misma página.
    expect(comoDeshacer("/catalogo?atr=tono-calido&categoria=Reflectores", destino)).toBe("atras");
  });

  it("ya se movió (otro filtro, otra página) ⇒ a la URL anterior", () => {
    expect(comoDeshacer("/catalogo?categoria=Reflectores&atr=tono-calido&pagina=2", destino)).toBe("anterior");
    expect(comoDeshacer("/producto/1101", destino)).toBe("anterior");
  });

  it("mismaUrlCatalogo fuera del catálogo compara el texto", () => {
    expect(mismaUrlCatalogo("/carrito", "/carrito/")).toBe(true);
    expect(mismaUrlCatalogo("/producto/1", "/producto/2")).toBe(false);
    expect(mismaUrlCatalogo("/catalogo?q=luz+calida", "/catalogo?q=luz%20calida")).toBe(true);
  });
});

describe("launcher oculto en mobile", () => {
  it("oculta en todo el checkout y no en otras rutas", async () => {
    const { ocultarLauncherEnRuta } = await import("./chat-ia-integracion");
    for (const r of ["/checkout", "/checkout/", "/checkout/pago", "/checkout/pedido/abc"]) {
      expect(ocultarLauncherEnRuta(r)).toBe(true);
    }
    for (const r of ["/", "/catalogo", "/carrito", "/checkoutx", "/mi-cuenta/checkout"]) {
      expect(ocultarLauncherEnRuta(r)).toBe(false);
    }
  });

  it("globals.css oculta por los dos atributos con el mismo corte que BREAKPOINT_MOBILE", async () => {
    const { readFileSync } = await import("node:fs");
    const { ATRIBUTO_OCULTO, ATRIBUTO_FILTROS_ABIERTOS, BREAKPOINT_MOBILE } = await import("./chat-ia-integracion");
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(`html[${ATRIBUTO_OCULTO}]`);
    expect(css).toContain(`html[${ATRIBUTO_FILTROS_ABIERTOS}]`);
    expect(css).toContain(`(max-width: ${BREAKPOINT_MOBILE - 0.02}px)`);
  });
});
