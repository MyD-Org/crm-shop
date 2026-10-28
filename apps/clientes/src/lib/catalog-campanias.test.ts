import { describe, expect, it } from "vitest";
import { mapFilaToProduct } from "./catalog";

// Campañas de precios en la exhibición (spec 2026-10-28-campanias-precios-design.md). Precios de la
// spec: general (tarjeta) 160 y transferencia 130 netos; campaña al 20 % = 128 y 104; IVA 21 %.
// Datos inventados.

const fila = {
  alegraId: "7",
  name: "Lámpara",
  code: "LAM-1",
  description: null,
  brand: "Philips",
  ivaPorcentaje: "21.00",
  prices: [
    { idPriceList: "G", name: "Tarjeta cuotas", price: 160, main: true },
    { idPriceList: "T", name: "Efectivo o Transferencia", price: 130 },
  ],
  stock: "10",
  categoryName: "Iluminación",
  overlayNombre: null,
  overlayFotos: null,
  campaniasOnline: [
    {
      id: "c1",
      reglaId: "r1",
      inicio: "2026-11-27T03:00:00.000Z",
      fin: "2026-12-01T03:00:00.000Z",
      pct: 20,
      unidades: null,
      precios: [
        { idPriceList: "G", price: 128 },
        { idPriceList: "T", price: 104 },
      ],
    },
  ],
};

const BF = { id: "c1", nombre: "Black Friday", etiqueta: "BF", fin: "2026-12-01T03:00:00.000Z" };
const transf = { slug: "transf", nombre: "Transferencia", idListaPrecios: "T" };
const sinHosts: string[] = [];

describe("mapFilaToProduct con campaña activa", () => {
  it("precio de campaña, normal tachado con IVA y los datos de la campaña", () => {
    const p = mapFilaToProduct(fila, undefined, sinHosts, null, { destacado: null, ficha: [], campanias: [BF] });
    expect(p.price).toBe(128);
    expect(p.precioFinal).toBe(154.88);
    expect(p.oldPrice).toBe(193.6);
    expect(p.discount).toBeUndefined(); // el % va en el badge, en verde (nunca el rojo del DS)
    expect(p.campania).toEqual({ id: "c1", nombre: "Black Friday", etiqueta: "BF", fin: BF.fin, pct: 20, unidades: null, quedan: null });
  });

  it("la línea \"$X con Transferencia\" muestra el precio de campaña de esa lista", () => {
    const p = mapFilaToProduct(fila, undefined, sinHosts, null, { destacado: transf, ficha: [transf], campanias: [BF] });
    expect(p.precioMedio).toEqual({ slug: "transf", nombre: "Transferencia", price: 104, precioFinal: 125.84 });
    expect(p.preciosMedios).toEqual([{ slug: "transf", nombre: "Transferencia", price: 104, precioFinal: 125.84 }]);
  });

  it("sin campañas activas: el producto de siempre", () => {
    const sin = mapFilaToProduct(fila, undefined, sinHosts, null, { destacado: transf, ficha: [transf] });
    const conOtra = mapFilaToProduct(fila, undefined, sinHosts, null, {
      destacado: transf,
      ficha: [transf],
      campanias: [{ ...BF, id: "otra" }],
    });
    for (const p of [sin, conOtra]) {
      expect(p.price).toBe(160);
      expect(p.oldPrice).toBeUndefined();
      expect(p.campania).toBeUndefined();
      expect(p.precioMedio?.price).toBe(130);
    }
  });

  it("unidades: el producto lleva el límite y lo que queda; agotado vuelve al normal", () => {
    const conLimite = {
      ...fila,
      campaniasOnline: [{ ...fila.campaniasOnline[0], unidades: 5 }],
    };
    const quedan = mapFilaToProduct(conLimite, undefined, sinHosts, null, {
      destacado: null,
      ficha: [],
      campanias: [BF],
      quedanCampania: { r1: 3 },
    });
    expect(quedan.campania).toMatchObject({ unidades: 5, quedan: 3 });
    const agotado = mapFilaToProduct(conLimite, undefined, sinHosts, null, {
      destacado: null,
      ficha: [],
      campanias: [BF],
      quedanCampania: { r1: 0 },
    });
    expect(agotado.price).toBe(160);
    expect(agotado.campania).toBeUndefined();
  });
});

describe("precioExhibidoDe (\"Desde $X\" de los modelos)", () => {
  it("con campaña activa, el precio de campaña con IVA; sin campañas, el normal", async () => {
    const { precioExhibidoDe } = await import("./catalog");
    expect(precioExhibidoDe(fila.prices, "21.00", undefined, fila.campaniasOnline, { destacado: null, ficha: [], campanias: [BF] })).toBe(154.88);
    expect(precioExhibidoDe(fila.prices, "21.00", undefined, fila.campaniasOnline, undefined)).toBe(193.6);
  });
});
