import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CuotasCard } from "./CuotasCard";
import { CuotasLinea } from "./CuotasLinea";
import { MediosDePagoDetalle } from "./MediosDePagoDetalle";
import type { OpcionCuotas } from "@/lib/cuotas-sin-interes";

/** Render estático (sin jsdom, ver vitest.config.ts): verifica QUÉ se muestra. */
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const opcion = (p: Partial<OpcionCuotas> = {}): OpcionCuotas => ({
  cuotas: 6,
  total: 120000,
  montoCuota: 20000,
  primeraCuota: 20000,
  sinInteres: true,
  ...p,
});

describe("CuotasLinea (card y ficha)", () => {
  it("siempre sin interés", () => {
    expect(texto(renderToStaticMarkup(createElement(CuotasLinea, { opcion: opcion() })))).toBe(
      "6 cuotas sin interés de $ 20.000,00",
    );
  });

  it("sin opción → nada", () => {
    expect(renderToStaticMarkup(createElement(CuotasLinea, { opcion: null }))).toBe("");
  });

  it("tamaño sm (card) es más chico que el default", () => {
    expect(renderToStaticMarkup(createElement(CuotasLinea, { opcion: opcion(), tamano: "sm" }))).toContain("text-xs");
    expect(renderToStaticMarkup(createElement(CuotasLinea, { opcion: opcion() }))).toContain("text-sm");
  });
});

describe("CuotasCard (slot installments de ProductCard)", () => {
  it("sólo la línea de cuotas, sin bloque propio", () => {
    const html = renderToStaticMarkup(createElement(CuotasCard, { opcion: opcion() }));
    expect(texto(html)).toBe("6 cuotas sin interés de $ 20.000,00");
    expect(html.startsWith("<span")).toBe(true);
  });

  it("sin opción → nada", () => {
    expect(renderToStaticMarkup(createElement(CuotasCard, { opcion: null }))).toBe("");
  });
});

describe("MediosDePagoDetalle (modal de la ficha)", () => {
  const html = renderToStaticMarkup(
    createElement(MediosDePagoDetalle, {
      medio: "Mercado Pago",
      precioContado: 121000,
      opciones: [
        opcion({ cuotas: 3, total: 100, montoCuota: 33.33, primeraCuota: 33.34 }),
        opcion({ cuotas: 6, total: 120000, montoCuota: 20000 }),
      ],
    }),
  );
  const t = texto(html);

  it("un bloque titulado con el medio y 1 pago a precio contado", () => {
    expect(t).toContain("Tarjetas de crédito (Mercado Pago)");
    expect(t.match(/1 pago Precio contado/g)).toHaveLength(1);
    expect(t).toContain("$ 121.000,00");
  });

  it("cada cantidad sin interés con su total; no hay CFT, TEA ni recargo", () => {
    expect(t).toContain("6 cuotas de $ 20.000,00 Sin interés");
    expect(t).toContain("$ 120.000,00");
    expect(t).not.toMatch(/CFT|TEA|recargo|con interés/i);
  });

  it("si el total no divide exacto, aclara la primera cuota", () => {
    expect(t).toContain("3 cuotas de $ 33,33 (la primera, $ 33,34)");
  });

  it("sección con encabezado accesible", () => {
    expect(html).toContain('aria-labelledby="medio-cuotas"');
    expect(html).toContain('id="medio-cuotas"');
  });
});
