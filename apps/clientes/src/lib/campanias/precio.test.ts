import { describe, expect, it } from "vitest";
import type { AlegraPrice } from "../alegra";
import { mapCampanias, resolverPrecioVigente, type EntradaCampania } from "./precio";

// Precios de ejemplo de la spec 2026-10-28-campanias-precios-design.md: lista general 160 (tarjeta,
// referencia) y transferencia 130; campaña al 20 % = 128 y 104. Datos inventados.

const GENERAL = "lista-tarjeta";
const TRANSF = "lista-transferencia";

const PRECIOS: AlegraPrice[] = [
  { idPriceList: GENERAL, name: "Tarjeta cuotas", price: 160, main: true },
  { idPriceList: TRANSF, name: "Efectivo o Transferencia", price: 130, main: false },
];

const BF: EntradaCampania = {
  id: "c1",
  reglaId: "r1",
  inicio: "2026-11-27T03:00:00.000Z",
  fin: "2026-12-01T03:00:00.000Z",
  pct: 20,
  unidades: null,
  precios: [
    { idPriceList: GENERAL, price: 128 },
    { idPriceList: TRANSF, price: 104 },
  ],
};

const activa = { activas: new Set(["c1"]) };

describe("resolverPrecioVigente", () => {
  it("campaña activa sin medio: la general con descuento", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], activa)).toEqual({ precio: 128, normal: 160, campania: BF, pct: 20 });
  });

  it("con la lista del medio: la de transferencia con descuento", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], activa, { idListaMedio: TRANSF })).toEqual({
      precio: 104,
      normal: 130,
      campania: BF,
      pct: 20,
    });
  });

  it("campaña no activa: el precio de siempre", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], { activas: new Set(["otra"]) })).toEqual({
      precio: 160,
      normal: 160,
      campania: null,
      pct: null,
    });
  });

  it("sin contexto o sin entradas: el precio de siempre", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], undefined).campania).toBeNull();
    expect(resolverPrecioVigente(PRECIOS, undefined, activa)).toMatchObject({ precio: 160, campania: null });
  });

  it("unidades agotadas: vuelve al normal; con unidades disponibles rige", () => {
    const conLimite = { ...BF, unidades: 5 };
    expect(resolverPrecioVigente(PRECIOS, [conLimite], { ...activa, quedan: new Map([["r1", 0]]) }).campania).toBeNull();
    expect(resolverPrecioVigente(PRECIOS, [conLimite], { ...activa, quedan: new Map([["r1", 2]]) }).precio).toBe(128);
  });

  it("cuenta privada 140: paga la campaña de la general (128) y el normal es su privado", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], activa, { precioPrivado: 140, idListaMedio: TRANSF })).toEqual({
      precio: 128,
      normal: 140,
      campania: BF,
      pct: 8,
    });
  });

  it("cuenta privada 120: su privado gana y no rige campaña", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], activa, { precioPrivado: 120 })).toEqual({
      precio: 120,
      normal: 120,
      campania: null,
      pct: null,
    });
  });

  it("cuenta privada sin precio para el producto (null): nunca rige campaña", () => {
    expect(resolverPrecioVigente(PRECIOS, [BF], activa, { precioPrivado: null })).toEqual({
      precio: 0,
      normal: 0,
      campania: null,
      pct: null,
    });
  });

  it("un precio de campaña <= 0 en la lista elegida no rige", () => {
    const rota = { ...BF, precios: [{ idPriceList: GENERAL, price: 0 }] };
    expect(resolverPrecioVigente(PRECIOS, [rota], activa).campania).toBeNull();
  });

  it("si la campaña no trae precio para la lista que usa el normal, no rige (el tachado es siempre de la misma lista)", () => {
    const soloGeneral = { ...BF, precios: [{ idPriceList: GENERAL, price: 128 }] };
    expect(resolverPrecioVigente(PRECIOS, [soloGeneral], activa, { idListaMedio: TRANSF })).toEqual({
      precio: 130,
      normal: 130,
      campania: null,
      pct: null,
    });
  });

  it("la primera entrada activa no agotada es la que rige", () => {
    const otra = { ...BF, id: "c2", reglaId: "r2", pct: 30, precios: [{ idPriceList: GENERAL, price: 112 }] };
    expect(resolverPrecioVigente(PRECIOS, [BF, otra], { activas: new Set(["c2"]) }).precio).toBe(112);
  });
});

describe("mapCampanias", () => {
  it("null o no arreglo: []", () => {
    expect(mapCampanias(null)).toEqual([]);
    expect(mapCampanias({})).toEqual([]);
  });

  it("normaliza números (Postgres puede mandar el numeric como string) e ignora elementos rotos", () => {
    const raw = [
      { ...BF, pct: "20", precios: [{ idPriceList: GENERAL, price: "128.00" }] },
      { id: "sin-precios" },
      "basura",
    ];
    expect(mapCampanias(raw)).toEqual([{ ...BF, precios: [{ idPriceList: GENERAL, price: 128 }] }]);
  });
});
