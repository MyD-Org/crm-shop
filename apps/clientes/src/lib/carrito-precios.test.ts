import { describe, expect, it } from "vitest";
import { precioLineaCarrito, type LineaPrecio } from "./carrito-precios";

const linea = (over: Partial<LineaPrecio> = {}): LineaPrecio => ({
  id: "1",
  qty: 4,
  precioUnitario: 514.08,
  ivaPorcentaje: 21,
  total: 2488.16,
  ...over,
});

describe("precioLineaCarrito", () => {
  it("con cotización vigente: unitario con IVA, neto aparte y el total cotizado", () => {
    expect(precioLineaCarrito(4, linea(), undefined)).toEqual({
      unitario: 622.04,
      neto: 514.08,
      total: 2488.16,
    });
  });

  it("mientras recotiza: unitario de la última cotización por la cantidad nueva", () => {
    expect(precioLineaCarrito(2, undefined, linea())).toEqual({
      unitario: 622.04,
      neto: 514.08,
      total: 1244.08,
    });
  });

  it("sin cotización o con problema: null", () => {
    expect(precioLineaCarrito(1, undefined, undefined)).toBeNull();
    expect(precioLineaCarrito(1, linea({ problema: "sin_stock" }), undefined)).toBeNull();
  });
});
