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

describe("precios online (0065): la lista del medio es un uuid de lista online", () => {
  const REF = "0f5d0c52-0000-4000-8000-00000000000a";
  const TRANSF = "0f5d0c52-0000-4000-8000-00000000000b";
  const CARA = "0f5d0c52-0000-4000-8000-00000000000c";
  // Lo que emite la vista: la referencia con `main`, y una entrada por lista online activa.
  const precios = [
    { idPriceList: REF, name: "Lista A", price: 120, main: true },
    { idPriceList: TRANSF, name: "Lista B", price: 110, main: false },
    { idPriceList: CARA, name: "Lista C", price: 190, main: false },
  ];
  const sel = (idLista: string) =>
    seleccionarMediosPrecio([medio("transferencia", { idListaPrecios: idLista, destacarEnCatalogo: true, mostrarEnFicha: true })], false);

  it("medio con una lista menor que la referencia: '$X con <Medio>'", () => {
    const r = armarPreciosMedios(precios, 21, sel(TRANSF));
    expect(r.precioMedio).toMatchObject({ slug: "transferencia", price: 110 });
    expect(r.preciosMedios).toHaveLength(1);
  });

  it("medio con una lista mayor o igual a la referencia: sin descuento, sin línea", () => {
    expect(armarPreciosMedios(precios, 21, sel(CARA))).toEqual({ preciosMedios: [] });
    expect(armarPreciosMedios(precios, 21, sel(REF))).toEqual({ preciosMedios: [] });
  });

  it("lista desactivada o inexistente (ya no viene en los precios): rige la referencia, sin línea", () => {
    expect(armarPreciosMedios(precios, 21, sel("0f5d0c52-0000-4000-8000-0000000000ff"))).toEqual({ preciosMedios: [] });
  });

  it("un producto sin precio online no muestra ninguna línea (nunca $0)", () => {
    expect(armarPreciosMedios([], 21, sel(TRANSF))).toEqual({ preciosMedios: [] });
  });
});

describe("cuotas sin interés (rebanada D)", () => {
  const mp = (extra: Partial<MedioPago> = {}) =>
    medio("mercadopago", {
      cobroOnline: true,
      idListaPrecios: null,
      condicionesCuotas: [
        { cuotas: 6, idListaPrecios: "L6" },
        { cuotas: 3, idListaPrecios: "L3" },
      ],
      ...extra,
    });

  it("con el flag prendido, los medios de cobro en línea con condiciones arman `cuotas` (ascendentes)", () => {
    const r = seleccionarMediosPrecio([medio("aa"), mp()], false, true);
    expect(r.cuotas).toEqual([
      {
        slug: "mercadopago",
        nombre: "MERCADOPAGO",
        idListaPagoUnico: null,
        condiciones: [
          { cuotas: 3, idListaPrecios: "L3" },
          { cuotas: 6, idListaPrecios: "L6" },
        ],
      },
    ]);
  });

  it("conviven varios medios: todos, en el orden del admin", () => {
    const r = seleccionarMediosPrecio(
      [mp({ slug: "payway", nombre: "Payway", orden: 2 }), mp({ orden: 1, nombre: "Mercado Pago" })],
      false,
      true,
    );
    expect(r.cuotas?.map((m) => m.slug)).toEqual(["mercadopago", "payway"]);
  });

  it("un medio inactivo, sin condiciones, sin cobro en línea o de cuenta corriente no se exhibe", () => {
    const r = seleccionarMediosPrecio(
      [
        mp({ slug: "a", activo: false }),
        mp({ slug: "b", condicionesCuotas: [] }),
        mp({ slug: "c", cobroOnline: false }),
        mp({ slug: "d", audiencia: "cuenta_corriente" }),
        mp({ slug: "e" }),
      ],
      false,
      true,
    );
    expect(r.cuotas?.map((m) => m.slug)).toEqual(["e"]);
  });

  it("`cuotas` lleva la lista del pago único del medio y el mínimo de cada condición", () => {
    const r = seleccionarMediosPrecio(
      [mp({ idListaPrecios: "LU", condicionesCuotas: [{ cuotas: 6, idListaPrecios: "L6", montoMinimo: 60000 }] })],
      false,
      true,
    );
    expect(r.cuotas?.[0]).toMatchObject({
      idListaPagoUnico: "LU",
      condiciones: [{ cuotas: 6, idListaPrecios: "L6", montoMinimo: 60000 }],
    });
  });

  it("flag apagado, medio inactivo, sin condiciones o sin cobro en línea: sin `cuotas`", () => {
    expect(seleccionarMediosPrecio([mp()], false, false).cuotas).toBeUndefined();
    expect(seleccionarMediosPrecio([mp()], false).cuotas).toBeUndefined();
    expect(seleccionarMediosPrecio([mp({ activo: false })], false, true).cuotas).toBeUndefined();
    expect(seleccionarMediosPrecio([mp({ condicionesCuotas: [] })], false, true).cuotas).toBeUndefined();
    expect(seleccionarMediosPrecio([mp({ cobroOnline: false })], false, true).cuotas).toBeUndefined();
  });

  it("con precio-especial-cuenta encendido tampoco hay cuotas", () => {
    expect(seleccionarMediosPrecio([mp()], true, true)).toEqual({ destacado: null, ficha: [] });
  });

  it("no pisa el destacado ni la ficha de los demás medios", () => {
    const r = seleccionarMediosPrecio([medio("aa", { destacarEnCatalogo: true, mostrarEnFicha: true }), mp()], false, true);
    expect(r.destacado?.slug).toBe("aa");
    expect(r.ficha.map((m) => m.slug)).toEqual(["aa"]);
  });

  describe("armarPreciosMedios: opciones por producto", () => {
    const prices = [
      { idPriceList: "REF", name: "Lista A", price: 1000, main: true },
      { idPriceList: "L3", name: "Lista B", price: 900, main: false },
      { idPriceList: "L6", name: "Lista C", price: 960, main: false },
    ];
    const mpCuotas = { slug: "mercadopago", nombre: "Mercado Pago", condiciones: [{ cuotas: 3, idListaPrecios: "L3" }, { cuotas: 6, idListaPrecios: "L6" }] };
    const cuotas = [mpCuotas];

    it("suma cuotasSinInteres con el total de cada lista", () => {
      const r = armarPreciosMedios(prices, 21, { destacado: null, ficha: [], cuotas });
      expect(r.cuotasSinInteres?.medios.map((m) => m.medio)).toEqual(["Mercado Pago"]);
      expect(r.cuotasSinInteres?.medios[0].opciones.map((o) => [o.cuotas, o.total, o.montoCuota])).toEqual([
        [3, 1089, 363],
        [6, 1161.6, 193.6],
      ]);
    });

    it("cada medio con sus condiciones y su mínimo; las no alcanzadas viajan aparte, sin monto", () => {
      const pw = { slug: "payway", nombre: "Payway", condiciones: [{ cuotas: 12, idListaPrecios: "L6", montoMinimo: 999999 }, { cuotas: 9, idListaPrecios: "L6" }] };
      const r = armarPreciosMedios(prices, 21, { destacado: null, ficha: [], cuotas: [mpCuotas, pw, { ...pw, slug: "otro", condiciones: [{ cuotas: 6, idListaPrecios: "L6", montoMinimo: 999999 }] }] });
      expect(r.cuotasSinInteres?.medios.map((m) => [m.slug, m.opciones.map((o) => o.cuotas)])).toEqual([
        ["mercadopago", [3, 6]],
        ["payway", [9]],
        ["otro", []],
      ]);
      expect(r.cuotasSinInteres?.medios.map((m) => m.noAlcanzadas ?? [])).toEqual([
        [],
        [{ cuotas: 12, minimo: 999999 }],
        [{ cuotas: 6, minimo: 999999 }],
      ]);
    });

    it("un medio sin opciones ni mínimos pendientes no aparece", () => {
      const vacio = { slug: "x", nombre: "X", condiciones: [] };
      const r = armarPreciosMedios(prices, 21, { destacado: null, ficha: [], cuotas: [vacio] });
      expect(r.cuotasSinInteres).toBeUndefined();
    });

    it("sin IVA conocido o sin cuotas: no suma el campo", () => {
      expect(armarPreciosMedios(prices, null, { destacado: null, ficha: [], cuotas })).toEqual({ preciosMedios: [] });
      expect(armarPreciosMedios(prices, 21, { destacado: null, ficha: [] })).toEqual({ preciosMedios: [] });
    });
  });
});
