import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PrecioMedio } from "@/data/products";
import { PrecioConImpuestos } from "./PrecioConImpuestos";
import { PrecioMedioCard } from "./PrecioMedio";

/** Render estático (sin jsdom, ver vitest.config.ts): verifica QUÉ se muestra. */
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const medio = (slug: string, nombre: string, price: number, precioFinal?: number): PrecioMedio => ({
  slug,
  nombre,
  price,
  precioFinal,
});

describe("PrecioMedioCard (cards)", () => {
  it("muestra '$X con <Medio>' con el precio final", () => {
    const t = texto(renderToStaticMarkup(createElement(PrecioMedioCard, { medio: medio("t", "Transferencia", 90000, 108900) })));
    expect(t).toMatch(/108\.900,00 con Transferencia/);
  });

  it("sin IVA conocido usa el neto", () => {
    const t = texto(renderToStaticMarkup(createElement(PrecioMedioCard, { medio: medio("t", "Transferencia", 90000) })));
    expect(t).toMatch(/90\.000,00 con Transferencia/);
  });

  it("precio de una forma de pago: se rotula con la forma en vez del medio", () => {
    const con = (forma: PrecioMedio["forma"]) =>
      texto(renderToStaticMarkup(createElement(PrecioMedioCard, { medio: { ...medio("mp", "Mercado Pago", 80000, 96800), forma } })));
    expect(con("debito")).toMatch(/96\.800,00 con débito$/);
    expect(con("credito")).toMatch(/96\.800,00 con crédito$/);
    expect(con("cuenta_mp")).toMatch(/96\.800,00 con dinero en cuenta de Mercado Pago$/);
    expect(con("debito")).not.toMatch(/Mercado Pago$/);
  });

  it("sin medio: nada (ni línea vacía ni $0)", () => {
    expect(renderToStaticMarkup(createElement(PrecioMedioCard, { medio: undefined }))).toBe("");
    expect(renderToStaticMarkup(createElement(PrecioMedioCard, { medio: null }))).toBe("");
  });
});

describe("PrecioConImpuestos (ficha)", () => {
  const base = { price: 100000, precioFinal: 121000 };

  it("precio de lista, sin impuestos y una línea por medio, en el orden recibido", () => {
    const html = renderToStaticMarkup(
      createElement(PrecioConImpuestos, {
        ...base,
        preciosMedios: [medio("a", "Alfa", 90000, 108900), medio("b", "Beta", 95000, 114950)],
      }),
    );
    const t = texto(html);
    expect(t.indexOf("121.000,00")).toBeLessThan(t.indexOf("sin impuestos"));
    expect(t.indexOf("sin impuestos")).toBeLessThan(t.indexOf("con Alfa"));
    expect(t.indexOf("con Alfa")).toBeLessThan(t.indexOf("con Beta"));
  });

  it("una línea por forma de un mismo medio, sin repetir la key", () => {
    const html = renderToStaticMarkup(
      createElement(PrecioConImpuestos, {
        ...base,
        preciosMedios: [
          { ...medio("mp", "Mercado Pago", 90000, 108900), forma: "credito" },
          { ...medio("mp", "Mercado Pago", 80000, 96800), forma: "debito" },
        ],
      }),
    );
    const t = texto(html);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(t.indexOf("con crédito")).toBeLessThan(t.indexOf("con débito"));
  });

  it("seis medios: seis líneas", () => {
    const medios = Array.from({ length: 6 }, (_, i) => medio(`m${i}`, `Medio ${i}`, 90000, 108900));
    const html = renderToStaticMarkup(createElement(PrecioConImpuestos, { ...base, preciosMedios: medios }));
    expect(html.match(/<li/g)).toHaveLength(6);
  });

  it("sin medios o vacío: sólo precio de lista y sin impuestos", () => {
    for (const preciosMedios of [undefined, []]) {
      const html = renderToStaticMarkup(createElement(PrecioConImpuestos, { ...base, preciosMedios }));
      expect(html).not.toContain("<li");
      expect(texto(html)).toMatch(/sin impuestos nacionales/);
    }
  });
});
