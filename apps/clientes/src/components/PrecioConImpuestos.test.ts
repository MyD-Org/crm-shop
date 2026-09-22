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
  it("precio final grande y neto con la leyenda legal", () => {
    const html = renderToStaticMarkup(
      createElement(PrecioConImpuestos, { price: 100000, precioFinal: 121000 }),
    );
    const t = texto(html);
    expect(t).toContain("$121.000,00");
    expect(t).toContain("precio sin impuestos nacionales $100.000,00");
    // El final va antes que el neto: es el principal.
    expect(t.indexOf("$121.000,00")).toBeLessThan(t.indexOf("$100.000,00"));
  });

  it("sin precio final: precio como hoy, sin neto", () => {
    const t = texto(
      renderToStaticMarkup(createElement(PrecioConImpuestos, { price: 100000 })),
    );
    expect(t).toBe("$100.000,00");
    expect(t).not.toContain("sin impuestos");
  });

});
