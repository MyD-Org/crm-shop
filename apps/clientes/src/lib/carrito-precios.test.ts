import { describe, expect, it } from "vitest";
import { precioLineaCarrito, totalesEstimados, type LineaPrecio } from "./carrito-precios";

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
      // Como cotizarItem: 514,08 × 2 = 1028,16 + IVA 215,91. No 622,04 × 2
      // (1244,08): eso difería un centavo de lo que después se cobra.
      total: 1244.07,
    });
  });

  it("sin cotización o con problema: null", () => {
    expect(precioLineaCarrito(1, undefined, undefined)).toBeNull();
    expect(precioLineaCarrito(1, linea({ problema: "sin_stock" }), undefined)).toBeNull();
  });
});

describe("totalesEstimados", () => {
  const ultimas = [
    linea({ id: "1", qty: 1, precioUnitario: 514.08, ivaPorcentaje: 21 }),
    linea({ id: "2", qty: 1, precioUnitario: 100, ivaPorcentaje: 10.5 }),
  ];

  it("suma con los unitarios cotizados y las cantidades nuevas, redondeando como cotizarItem", () => {
    // 514,08 × 3 = 1542,24 → IVA 323,87; 100 × 2 = 200 → IVA 21.
    expect(totalesEstimados([{ id: "1", qty: 3 }, { id: "2", qty: 2 }], ultimas)).toEqual({
      subtotal: 1742.24,
      iva: 344.87,
      total: 2087.11,
      unidades: 5,
    });
  });

  it("el total de la línea mientras recotiza usa el mismo redondeo", () => {
    expect(precioLineaCarrito(3, undefined, ultimas[0])?.total).toBe(1866.11);
  });

  it("sin cotización previa, con un producto nuevo o con problema: null", () => {
    expect(totalesEstimados([{ id: "1", qty: 1 }], null)).toBeNull();
    expect(totalesEstimados([{ id: "3", qty: 1 }], ultimas)).toBeNull();
    expect(
      totalesEstimados([{ id: "1", qty: 1 }], [linea({ id: "1", problema: "sin_stock" })]),
    ).toBeNull();
  });
});
