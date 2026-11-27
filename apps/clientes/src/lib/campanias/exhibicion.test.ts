import { describe, expect, it } from "vitest";
import { campaniaParaExhibir } from "./exhibicion";

// Datos inventados: lista general 100 neto, transferencia 80 neto; campaña al 10 % en las dos.
const GENERAL = "l-general";
const TRANSF = "l-transf";
const prices = [
  { idPriceList: GENERAL, name: "General", price: 100, main: true },
  { idPriceList: TRANSF, name: "Transferencia", price: 80 },
];
const campanias = [
  {
    id: "c1",
    reglaId: "r1",
    inicio: "2026-11-01T00:00:00Z",
    fin: "2026-12-01T00:00:00Z",
    pct: 10,
    unidades: null,
    precios: [
      { idPriceList: GENERAL, price: 90 },
      { idPriceList: TRANSF, price: 72 },
    ],
  },
];
const activas = [{ id: "c1", nombre: "BF", etiqueta: "BF", fin: "2026-12-01T00:00:00Z" }];
const transferencia = { slug: "transferencia", nombre: "Transferencia", idListaPrecios: TRANSF };

describe("campaniaParaExhibir: habituales de los medios de la ficha", () => {
  it("trae el precio NORMAL con IVA de cada medio de la ficha (lo que tacha el recuadro)", () => {
    const r = campaniaParaExhibir(prices as never, campanias, { campanias: activas, destacado: null, ficha: [transferencia] as never }, undefined, 21);
    expect(r?.campania.habitualesMedios).toEqual([{ slug: "transferencia", precioFinal: 96.8 }]);
  });

  it("sin medios de ficha no agrega el campo (cards y catálogo como antes)", () => {
    const r = campaniaParaExhibir(prices as never, campanias, { campanias: activas, destacado: null }, undefined, 21);
    expect(r).not.toBeNull();
    expect(r?.campania).not.toHaveProperty("habitualesMedios");
  });
});
