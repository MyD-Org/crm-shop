import { describe, expect, it } from "vitest";
import { mapFilaToProduct } from "./catalog";

const fila = {
  alegraId: "7",
  name: "Lámpara",
  code: "LAM-1",
  description: null,
  brand: "Philips",
  ivaPorcentaje: "21.00",
  prices: [
    { idPriceList: "1", name: "General", price: 100000, main: true },
    { idPriceList: "L1", name: "Lista 1", price: 90000 },
    { idPriceList: "L2", name: "Lista 2", price: 100000 },
  ],
  stock: "10",
  categoryName: "Iluminación",
  overlayNombre: null,
  overlayFotos: null,
};

const medios = {
  destacado: { slug: "transf", nombre: "Transferencia", idListaPrecios: "L1" },
  ficha: [
    { slug: "transf", nombre: "Transferencia", idListaPrecios: "L1" },
    { slug: "otro", nombre: "Otro", idListaPrecios: "L2" },
  ],
};
const sinHosts: string[] = [];

describe("mapFilaToProduct con medios de pago con lista", () => {
  it("arma precioMedio (card) y preciosMedios (ficha) sólo con precio menor", () => {
    const p = mapFilaToProduct(fila, undefined, sinHosts, null, medios);
    expect(p.price).toBe(100000);
    expect(p.precioMedio).toEqual({ slug: "transf", nombre: "Transferencia", price: 90000, precioFinal: 108900 });
    expect(p.preciosMedios).toEqual([{ slug: "transf", nombre: "Transferencia", price: 90000, precioFinal: 108900 }]);
  });

  it("sin medios, el producto de siempre", () => {
    const p = mapFilaToProduct(fila, undefined, sinHosts, null);
    expect(p.precioMedio).toBeUndefined();
    expect(p.preciosMedios).toBeUndefined();
  });

  it("cards con ficha vacía: sólo el destacado", () => {
    const p = mapFilaToProduct(fila, undefined, sinHosts, null, { destacado: medios.destacado, ficha: [] });
    expect(p.precioMedio?.price).toBe(90000);
    expect(p.preciosMedios).toEqual([]);
  });

  it("mismo número que el checkout: lo exhibido es lo que da precioDeLista de la lista del medio", () => {
    const p = mapFilaToProduct(fila, undefined, sinHosts, null, medios);
    const cotizado = mapFilaToProduct(fila, "L1", sinHosts, null);
    expect(p.precioMedio?.price).toBe(cotizado.price);
    expect(p.precioMedio?.precioFinal).toBe(cotizado.precioFinal);
  });
});
