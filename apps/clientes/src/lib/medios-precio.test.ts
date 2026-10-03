import { describe, expect, it } from "vitest";
import type { MedioPago } from "./medios-pago";
import { armarPreciosMedios, seleccionarMediosPrecio } from "./medios-precio";

function medio(slug: string, extra: Partial<MedioPago> = {}): MedioPago {
  return {
    slug,
    nombre: slug.toUpperCase(),
    instrucciones: "",
    activo: true,
    aplicaRetiro: true,
    aplicaEnvio: true,
    cobroOnline: false,
    orden: 0,
    idListaPrecios: "L1",
    destacarEnCatalogo: false,
    mostrarEnFicha: false,
    ...extra,
  };
}

describe("seleccionarMediosPrecio", () => {
  it("destacado: el activo con lista y destacarEnCatalogo", () => {
    const r = seleccionarMediosPrecio([medio("aa"), medio("bb", { destacarEnCatalogo: true })], false);
    expect(r.destacado).toEqual({ slug: "bb", nombre: "BB", idListaPrecios: "L1" });
  });

  it("sin destacado: null", () => {
    expect(seleccionarMediosPrecio([medio("aa")], false).destacado).toBeNull();
  });

  it("destacado inactivo o sin lista: null", () => {
    expect(seleccionarMediosPrecio([medio("aa", { destacarEnCatalogo: true, activo: false })], false).destacado).toBeNull();
    expect(seleccionarMediosPrecio([medio("aa", { destacarEnCatalogo: true, idListaPrecios: null })], false).destacado).toBeNull();
  });

  it("ficha: activos con lista y mostrarEnFicha, por orden y desempate por nombre y slug", () => {
    const r = seleccionarMediosPrecio(
      [
        medio("cc", { mostrarEnFicha: true, orden: 2 }),
        medio("bb", { mostrarEnFicha: true, orden: 1, nombre: "Beta" }),
        medio("aa", { mostrarEnFicha: true, orden: 1, nombre: "Alfa" }),
        medio("dd", { mostrarEnFicha: false, orden: 0 }),
        medio("ee", { mostrarEnFicha: true, orden: 0, activo: false }),
        medio("ff", { mostrarEnFicha: true, orden: 0, idListaPrecios: null }),
      ],
      false,
    );
    expect(r.ficha.map((m) => m.slug)).toEqual(["aa", "bb", "cc"]);
  });

  it("ficha sin límite de cantidad", () => {
    const medios = Array.from({ length: 6 }, (_, i) => medio(`m${i}`, { mostrarEnFicha: true, orden: i }));
    expect(seleccionarMediosPrecio(medios, false).ficha).toHaveLength(6);
  });

  it("ignora a_coordinar", () => {
    const r = seleccionarMediosPrecio([medio("a_coordinar", { mostrarEnFicha: true, destacarEnCatalogo: true })], false);
    expect(r).toEqual({ destacado: null, ficha: [] });
  });

  it("con el flag precio-especial-cuenta encendido: vacío", () => {
    const medios = [medio("aa", { destacarEnCatalogo: true, mostrarEnFicha: true })];
    expect(seleccionarMediosPrecio(medios, true)).toEqual({ destacado: null, ficha: [] });
  });
});

describe("armarPreciosMedios", () => {
  const prices = [
    { idPriceList: "1", name: "General", price: 100000, main: true },
    { idPriceList: "L1", name: "Lista 1", price: 90000 },
    { idPriceList: "L2", name: "Lista 2", price: 100000 },
    { idPriceList: "L3", name: "Lista 3", price: 0 },
    { idPriceList: "L4", name: "Lista 4", price: 120000 },
    { idPriceList: "L5", name: "Lista 5", price: 80000 },
  ];
  const m = (slug: string, lista: string) => ({ slug, nombre: slug.toUpperCase(), idListaPrecios: lista });

  it("destacado: precio y precioFinal cuando es menor", () => {
    const r = armarPreciosMedios(prices, 21, { destacado: m("aa", "L1"), ficha: [] });
    expect(r.precioMedio).toEqual({ slug: "aa", nombre: "AA", price: 90000, precioFinal: 108900 });
    expect(r.preciosMedios).toEqual([]);
  });

  it("sin IVA conocido no hay precioFinal", () => {
    const r = armarPreciosMedios(prices, null, { destacado: m("aa", "L1"), ficha: [] });
    expect(r.precioMedio).toEqual({ slug: "aa", nombre: "AA", price: 90000 });
  });

  it("omite si falta el precio, es 0, igual o mayor al general", () => {
    for (const lista of ["L2", "L3", "L4", "ZZ"]) {
      const r = armarPreciosMedios(prices, 21, { destacado: m("aa", lista), ficha: [m("aa", lista)] });
      expect(r.precioMedio).toBeUndefined();
      expect(r.preciosMedios).toEqual([]);
    }
  });

  it("ficha: conserva el orden recibido y omite los que no califican", () => {
    const r = armarPreciosMedios(prices, 21, { destacado: null, ficha: [m("a", "L5"), m("b", "L4"), m("c", "L1")] });
    expect(r.preciosMedios?.map((p) => p.slug)).toEqual(["a", "c"]);
    expect(r.preciosMedios?.[0].precioFinal).toBe(96800);
  });

  it("sin medios: nada", () => {
    expect(armarPreciosMedios(prices, 21, { destacado: null, ficha: [] })).toEqual({ preciosMedios: [] });
    expect(armarPreciosMedios(prices, 21, undefined)).toEqual({});
  });
});
