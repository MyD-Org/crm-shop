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
      precioContado: 121000,
      opciones: [
        opcion({ cuotas: 3, total: 100, montoCuota: 33.34 }),
        opcion({ cuotas: 6, total: 120000, montoCuota: 20000 }),
      ],
    }),
  );
  const t = texto(html);

  it("un solo bloque \"Tarjeta de crédito o débito\", sin nombrar al procesador, y 1 pago a precio contado", () => {
    expect(t).toContain("Tarjeta de crédito o débito");
    expect(t).not.toMatch(/Mercado Pago|Payway/);
    expect(html.match(/<section/g)).toHaveLength(1);
    expect(t.match(/1 pago Precio contado/g)).toHaveLength(1);
    expect(t).toContain("$ 121.000,00");
  });

  it("cada cantidad sin interés con su total; no hay CFT, TEA ni recargo", () => {
    expect(t).toContain("6 cuotas de $ 20.000,00 Sin interés");
    expect(t).toContain("$ 120.000,00");
    expect(t).not.toMatch(/CFT|TEA|recargo|con interés/i);
  });

  it("el monto por cuota va redondeado hacia arriba, sin aclarar la primera cuota", () => {
    expect(t).toContain("3 cuotas de $ 33,34");
    expect(t).not.toContain("la primera");
  });

  it("sección con encabezado accesible", () => {
    expect(html).toContain('aria-labelledby="medio-cuotas"');
    expect(html).toContain('id="medio-cuotas"');
  });
});

describe("MediosDePagoDetalle con cuotas que el producto no alcanza", () => {
  const html = renderToStaticMarkup(
    createElement(MediosDePagoDetalle, {
      precioContado: 121000,
      opciones: [opcion({ cuotas: 3, total: 100, montoCuota: 33.34 })],
      noAlcanzadas: [
        { cuotas: 6, minimo: 90000 },
        { cuotas: 12, minimo: 200000 },
      ],
    }),
  );
  const t = texto(html);

  it("texto con el mínimo y sin monto por cuota, atenuadas y después de las alcanzadas", () => {
    expect(t).toContain("6 cuotas sin interés en compras desde $ 90.000");
    expect(t).toContain("12 cuotas sin interés en compras desde $ 200.000");
    expect(t).not.toMatch(/6 cuotas de/);
    expect(html.match(/data-no-alcanzada/g)).toHaveLength(2);
    expect(html.indexOf("3 cuotas de")).toBeLessThan(html.indexOf("data-no-alcanzada"));
    expect(html).toContain("text-muted");
  });
});

describe("MediosDePagoDetalle con el carrito", () => {
  const props = {
    precioContado: 5000,
    opciones: [opcion({ cuotas: 6, total: 5382.06, montoCuota: 897.01 })],
    noAlcanzadas: [
      { cuotas: 8, minimo: 30000 },
      { cuotas: 12, minimo: 90000 },
    ],
  };

  it("el nivel que alcanza con el carrito pasa a ser una fila de cuotas con el monto del producto y la nota del mínimo", () => {
    const html = renderToStaticMarkup(
      createElement(MediosDePagoDetalle, { ...props, conCarrito: { cuotas: 8, total: 15113.84, montoCuota: 1889.23 } }),
    );
    const t = texto(html);
    expect(t).toContain("8 cuotas de $ 1.889,23 Sin interés En compras desde $ 30.000");
    expect(t).not.toContain("8 cuotas sin interés en compras desde");
    expect(t).toContain("12 cuotas sin interés en compras desde $ 90.000");
    expect(html.match(/data-no-alcanzada/g)).toHaveLength(1);
    expect(html.indexOf("6 cuotas de")).toBeLessThan(html.indexOf("8 cuotas de"));
  });

  it("sin carrito, la fila queda atenuada con el mínimo sin ,00", () => {
    const t = texto(renderToStaticMarkup(createElement(MediosDePagoDetalle, props)));
    expect(t).toContain("8 cuotas sin interés en compras desde $ 30.000");
    expect(t).not.toContain("30.000,00");
    expect(t).not.toContain("Le faltan");
  });
});
