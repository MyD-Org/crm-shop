import { describe, expect, it } from "vitest";
import type { CampaniaProducto } from "@/data/products";
import { filtrarOfertasCuenta, hayOfertasParaCuenta, ofertasQueAplican, type OfertasCuenta } from "./ofertas-cuenta";

// Datos inventados. `price` = precio de campaña (neto) de la lista general; privados = lista de la cuenta.
const C = { id: "c1", etiqueta: "Oferta", pct: 9 } as unknown as CampaniaProducto;
const productos = [
  { id: "1", price: 100, campania: C }, // su lista 120: la oferta le conviene
  { id: "2", price: 100, campania: C }, // su lista 80: paga su precio, la oferta no le sirve
  { id: "3", price: 100, campania: C }, // sin precio en su lista ("Consulte"): no le aplica
  { id: "4", price: 100, campania: undefined }, // sin campaña
  { id: "5", price: 100, campania: C }, // su lista igual: no es más barata, no le aplica
];
const privados = { "1": { price: 120 }, "2": { price: 80 }, "3": null, "4": { price: 200 }, "5": { price: 100 } };

describe("ofertasQueAplican", () => {
  it("sólo las campañas con precio menor que el de su lista", () => {
    expect(ofertasQueAplican(productos, privados)).toEqual(["1"]);
  });
  it("sin ofertas que le ganen a su lista, ninguna", () => {
    expect(ofertasQueAplican(productos, { "1": { price: 90 } })).toEqual([]);
  });
});

describe("filtrarOfertasCuenta / hayOfertasParaCuenta", () => {
  const privada = (ids: string[]): OfertasCuenta => ({ tipo: "privado", ids: new Set(ids) });
  it("público y pendiente: todas, y hay ofertas", () => {
    for (const o of [{ tipo: "publico" }, { tipo: "pendiente" }] as OfertasCuenta[]) {
      expect(filtrarOfertasCuenta(productos, o)).toHaveLength(5);
      expect(hayOfertasParaCuenta(o)).toBe(true);
    }
  });
  it("lista privada: sólo las que le aplican; sin ninguna, no hay ofertas", () => {
    expect(filtrarOfertasCuenta(productos, privada(["1"])).map((p) => p.id)).toEqual(["1"]);
    expect(hayOfertasParaCuenta(privada(["1"]))).toBe(true);
    expect(filtrarOfertasCuenta(productos, privada([]))).toEqual([]);
    expect(hayOfertasParaCuenta(privada([]))).toBe(false);
  });
});
