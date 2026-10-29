import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import type { PromocionesContent } from "./tipos";
import { contenidoConCampania } from "./promo";

// La sección Promociones de la home asociada a una campaña de precios (spec
// 2026-10-28-campanias-precios-design.md, "Sección Promociones"). Datos inventados.

const CAMPANIA = { id: "c1", nombre: "Apertura", etiqueta: "Precio de apertura", inicio: "2026-11-01T03:00:00.000Z", fin: "2026-11-14T02:59:00.000Z" };

const contenido: PromocionesContent = {
  etiquetaBadge: "Precio de apertura",
  campaniaId: "c1",
  estrella: { sku: "NK-1", precioHabitual: 999, unidadesPromo: 9, stockBase: 9 },
  items: [{ sku: "A1", precioHabitual: 888 }, { sku: "B2", precioHabitual: 777 }],
};

const conCampania = (sku: string, extra: Partial<Product> = {}) =>
  ({
    id: sku,
    sku,
    name: sku,
    price: 128,
    precioFinal: 154.88,
    oldPrice: 193.6,
    stock: "in",
    campania: { id: "c1", nombre: "Apertura", etiqueta: "Precio de apertura", fin: CAMPANIA.fin, pct: 20, unidades: 5, quedan: 3, habitualMedio: 157.3 },
    ...extra,
  }) as unknown as Product;

describe("contenidoConCampania", () => {
  it("las fechas son las de la campaña", () => {
    const c = contenidoConCampania(contenido, CAMPANIA, []);
    expect(c.inicio).toBe(CAMPANIA.inicio);
    expect(c.fin).toBe(CAMPANIA.fin);
  });

  it("el precio habitual es el normal de la MISMA lista que se muestra grande (transferencia si hay medio)", () => {
    const conMedio = conCampania("A1", { precioMedio: { slug: "transf", nombre: "Transferencia", price: 104, precioFinal: 125.84 } });
    const sinMedio = conCampania("NK-1");
    const c = contenidoConCampania(contenido, CAMPANIA, [conMedio, sinMedio]);
    expect(c.items[0].precioHabitual).toBe(157.3);
    expect(c.estrella?.precioHabitual).toBe(193.6);
  });

  it("las unidades de la estrella son las de la regla de la campaña", () => {
    const c = contenidoConCampania(contenido, CAMPANIA, [conCampania("NK-1")]);
    expect(c.estrella?.unidadesPromo).toBe(5);
  });

  it("un producto sin campaña conserva lo cargado (compatibilidad)", () => {
    const sin = { id: "B2", sku: "B2", name: "B2", price: 100, stock: "in" } as unknown as Product;
    expect(contenidoConCampania(contenido, CAMPANIA, [sin]).items[1].precioHabitual).toBe(777);
  });

  it("sin campaña asociada o inexistente: el contenido tal cual", () => {
    expect(contenidoConCampania({ ...contenido, campaniaId: undefined }, CAMPANIA, [])).toEqual({ ...contenido, campaniaId: undefined });
    expect(contenidoConCampania(contenido, undefined, [])).toBe(contenido);
  });
});

describe("frasePrecio (etiqueta de campaña en una frase)", () => {
  it("una etiqueta que ya es \"Precio de …\" no se duplica", async () => {
    const { frasePrecio } = await import("./promo");
    expect(frasePrecio("Precio de apertura")).toBe("precio de apertura");
    expect(frasePrecio("Precio de apertura", true)).toBe("Precio de apertura");
  });
  it("un nombre (\"Black Friday\") lleva \"precio de\" y conserva sus mayúsculas", async () => {
    const { frasePrecio } = await import("./promo");
    expect(frasePrecio("Black Friday")).toBe("precio de Black Friday");
    expect(frasePrecio("Black Friday", true)).toBe("Precio de Black Friday");
    expect(frasePrecio("BF")).toBe("precio de BF");
  });
});
