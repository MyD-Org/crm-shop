import { describe, expect, it } from "vitest";
import type { AlegraItem } from "./alegra";
import { mapFilaToProduct, mapItemToProduct } from "./catalog";

/**
 * `price` sigue siendo el NETO (lo usan carrito, AddToCartButton y cotización).
 * El precio final con IVA viaja aparte y sólo si hay IVA conocido.
 */

const fila = {
  alegraId: "7",
  name: "Lámpara",
  code: "LAM-1",
  description: null,
  brand: "Philips",
  prices: [
    { idPriceList: "1", name: "General", price: 100000, main: true },
    { idPriceList: "2", name: "Mayorista", price: 80000 },
  ],
  stock: "10",
  categoryName: "Iluminación",
};

describe("mapFilaToProduct (espejo)", () => {
  it("IVA 21%: precio neto intacto y precio final 121.000", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: "21.00" });
    expect(p.price).toBe(100000);
    expect(p.ivaPorcentaje).toBe(21);
    expect(p.precioFinal).toBe(121000);
  });

  it("IVA 10,5%: precio final 110.500", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: "10.50" });
    expect(p.precioFinal).toBe(110500);
  });

  it("cada lista de precios calcula su propio precio final", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: "21.00" }, "2");
    expect(p.price).toBe(80000);
    expect(p.precioFinal).toBe(96800);
  });

  it("sin IVA persistido no inventa precio final", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: null });
    expect(p.price).toBe(100000);
    expect(p.ivaPorcentaje).toBeUndefined();
    expect(p.precioFinal).toBeUndefined();
  });
});

describe("mapItemToProduct (ficha en vivo)", () => {
  const item: AlegraItem = {
    id: "7",
    name: "Lámpara",
    status: "active",
    price: [{ idPriceList: "1", price: 100000, main: true }],
  };

  it("usa el tax en vivo del ítem", () => {
    const p = mapItemToProduct({ ...item, tax: [{ percentage: "21.00" }] });
    expect(p.price).toBe(100000);
    expect(p.ivaPorcentaje).toBe(21);
    expect(p.precioFinal).toBe(121000);
  });

  it("sin tax: misma regla que el espejo (sin default)", () => {
    const p = mapItemToProduct(item);
    expect(p.ivaPorcentaje).toBeUndefined();
    expect(p.precioFinal).toBeUndefined();
  });
});
