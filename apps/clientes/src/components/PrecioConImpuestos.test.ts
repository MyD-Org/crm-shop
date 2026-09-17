import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrecioConImpuestos } from "./PrecioConImpuestos";

/**
 * Render a string con react-dom/server: alcanza para verificar QUÉ se muestra
 * sin sumar jsdom (ver vitest.config.ts).
 */
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("PrecioConImpuestos", () => {
  it("ficha: precio final grande y neto con la leyenda legal", () => {
    const html = renderToStaticMarkup(
      createElement(PrecioConImpuestos, { price: 100000, precioFinal: 121000 }),
    );
    const t = texto(html);
    expect(t).toContain("$121.000");
    expect(t).toContain("PRECIO SIN IMPUESTOS NACIONALES $100.000");
    // El final va antes que el neto: es el principal.
    expect(t.indexOf("$121.000")).toBeLessThan(t.indexOf("$100.000"));
  });

  it("sin precio final: precio como hoy, sin neto", () => {
    const t = texto(
      renderToStaticMarkup(createElement(PrecioConImpuestos, { price: 100000 })),
    );
    expect(t).toBe("$100.000");
    expect(t).not.toContain("SIN IMPUESTOS");
  });

  it("variante nota (card): sólo la línea del neto, y nada si no hay precio final", () => {
    const conFinal = texto(
      renderToStaticMarkup(
        createElement(PrecioConImpuestos, { price: 100000, precioFinal: 110500, variante: "nota" }),
      ),
    );
    expect(conFinal).toBe("PRECIO SIN IMPUESTOS NACIONALES $100.000");

    const sinFinal = renderToStaticMarkup(
      createElement(PrecioConImpuestos, { price: 100000, variante: "nota" }),
    );
    expect(sinFinal).toBe("");
  });
});
