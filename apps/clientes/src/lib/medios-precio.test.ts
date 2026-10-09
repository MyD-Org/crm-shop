import { describe, expect, it } from "vitest";
import type { MedioPago } from "./medios-pago";
import { preciosFormaDelModal } from "./precios-forma-modal";
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
    expect(armarPreciosMedios(precios, 21, sel(CARA))).toMatchObject({ preciosMedios: [] });
    expect(armarPreciosMedios(precios, 21, sel(REF))).toMatchObject({ preciosMedios: [] });
  });

  it("lista desactivada o inexistente (ya no viene en los precios): rige la referencia, sin línea", () => {
    expect(armarPreciosMedios(precios, 21, sel("0f5d0c52-0000-4000-8000-0000000000ff"))).toMatchObject({ preciosMedios: [] });
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

describe("listas por forma de pago (change listas-por-forma-de-pago)", () => {
  // Referencia 100.000; crédito L1 (90.000), débito L5 (80.000), cuenta MP L5.
  const precios = [
    { idPriceList: "1", name: "General", price: 100000, main: true },
    { idPriceList: "L1", name: "Lista 1", price: 90000 },
    { idPriceList: "L5", name: "Lista 5", price: 80000 },
    { idPriceList: "L6", name: "Lista 6", price: 70000 },
  ];
  const mp = (extra: Partial<MedioPago> = {}) =>
    medio("mercadopago", { cobroOnline: true, destacarEnCatalogo: true, mostrarEnFicha: true, ...extra });
  const pw = (extra: Partial<MedioPago> = {}) =>
    medio("payway", { cobroOnline: true, destacarEnCatalogo: true, mostrarEnFicha: true, nombre: "Payway", ...extra });

  it("sin filas por forma: salida idéntica a la de siempre (sin listasPorForma ni forma)", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: "L1" })], false);
    expect(sel.destacado).toEqual({ slug: "mercadopago", nombre: "MERCADOPAGO", idListaPrecios: "L1" });
    const r = armarPreciosMedios(precios, null, sel);
    expect(r.precioMedio).toEqual({ slug: "mercadopago", nombre: "MERCADOPAGO", price: 90000 });
    expect(r.preciosMedios).toHaveLength(1);
    expect(r.preciosMedios?.[0].forma).toBeUndefined();
  });

  it("un medio solo con listas por forma (sin lista del medio) es elegible", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: null, listasPorForma: { debito: "L5" } })], false);
    expect(sel.destacado?.idListaPrecios).toBe("");
    expect(sel.destacado?.listasPorForma).toEqual([
      { forma: "credito", idListaPrecios: "" },
      { forma: "debito", idListaPrecios: "L5" },
      { forma: "cuenta_mp", idListaPrecios: "" },
    ]);
    expect(sel.ficha).toHaveLength(1);
  });

  it("cada forma sin lista propia hereda la del medio", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: "L1", listasPorForma: { debito: "L5" } })], false);
    expect(sel.destacado?.listasPorForma?.map((f) => f.idListaPrecios)).toEqual(["L1", "L5", "L1"]);
  });

  it("Payway ofrece solo crédito y débito; una fila de cuenta MP se ignora", () => {
    const sel = seleccionarMediosPrecio([pw({ idListaPrecios: null, listasPorForma: { debito: "L5", cuenta_mp: "L6" } })], false);
    expect(sel.destacado?.listasPorForma?.map((f) => f.forma)).toEqual(["credito", "debito"]);
    const soloCuenta = seleccionarMediosPrecio([pw({ idListaPrecios: null, listasPorForma: { cuenta_mp: "L6" } })], false);
    expect(soloCuenta.destacado).toBeNull();
  });

  it("otro medio que no es de Mercado Pago ni de Payway ignora las listas por forma", () => {
    const sel = seleccionarMediosPrecio([medio("transferencia", { destacarEnCatalogo: true, idListaPrecios: null, listasPorForma: { debito: "L5" } })], false);
    expect(sel.destacado).toBeNull();
  });

  it("modal: MP con débito distinto y mostrarEnFicha=false igual separa por forma", () => {
    const sel = seleccionarMediosPrecio(
      [mp({ idListaPrecios: "L1", listasPorForma: { debito: "L5" }, mostrarEnFicha: false, destacarEnCatalogo: false })],
      false,
    );
    expect(sel.ficha).toHaveLength(0);
    expect(sel.modal).toHaveLength(1);
    const r = armarPreciosMedios(precios, 21, sel);
    expect(r.preciosMedios).toEqual([]);
    expect(r.preciosFormaModal?.map((x) => [x.forma, x.price])).toEqual([
      ["credito", 90000],
      ["debito", 80000],
      ["cuenta_mp", 90000],
    ]);
    expect(preciosFormaDelModal(r.preciosFormaModal, 108900)).toEqual({ debito: 96800, credito: 108900 });
  });

  it("modal: sin listas por forma o medio sin cobro en línea no suma nada", () => {
    expect(seleccionarMediosPrecio([mp({ idListaPrecios: "L1" })], false).modal).toBeUndefined();
    expect(seleccionarMediosPrecio([mp({ cobroOnline: false, listasPorForma: { debito: "L5" } })], false).modal).toBeUndefined();
  });

  it("card: la lista del medio (forma NULL) gana aunque una forma sea más barata", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: "L1", listasPorForma: { debito: "L5" } })], false);
    const r = armarPreciosMedios(precios, null, sel);
    expect(r.precioMedio).toEqual({ slug: "mercadopago", nombre: "MERCADOPAGO", price: 90000 });
  });

  it("card: sin lista del medio, la forma MÁS BARATA con su rótulo", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: null, listasPorForma: { credito: "L1", debito: "L5" } })], false);
    const r = armarPreciosMedios(precios, null, sel);
    expect(r.precioMedio).toEqual({ slug: "mercadopago", nombre: "MERCADOPAGO", price: 80000, forma: "debito" });
  });

  it("card: con empate gana la primera forma; sin descuento en ninguna, sin línea", () => {
    const empate = seleccionarMediosPrecio([mp({ idListaPrecios: null, listasPorForma: { debito: "L5", cuenta_mp: "L5" } })], false);
    expect(armarPreciosMedios(precios, null, empate).precioMedio?.forma).toBe("debito");
    const nada = seleccionarMediosPrecio([mp({ idListaPrecios: null, listasPorForma: { debito: "ZZ" } })], false);
    expect(armarPreciosMedios(precios, null, nada).precioMedio).toBeUndefined();
  });

  it("ficha: una línea por forma cuando los precios difieren (Mercado Pago)", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: null, listasPorForma: { credito: "L1", debito: "L5", cuenta_mp: "L5" } })], false);
    const r = armarPreciosMedios(precios, 21, sel);
    expect(r.preciosMedios?.map((p) => [p.forma, p.price])).toEqual([
      ["credito", 90000],
      ["debito", 80000],
      ["cuenta_mp", 80000],
    ]);
    expect(r.preciosMedios?.[0].precioFinal).toBe(108900);
  });

  it("ficha: una línea por forma cuando los precios difieren (Payway: crédito y débito)", () => {
    const sel = seleccionarMediosPrecio([pw({ idListaPrecios: null, listasPorForma: { credito: "L1", debito: "L5" } })], false);
    const r = armarPreciosMedios(precios, null, sel);
    expect(r.preciosMedios?.map((p) => p.forma)).toEqual(["credito", "debito"]);
  });

  it("ficha: una forma sin descuento respecto de la referencia no tiene línea", () => {
    const sel = seleccionarMediosPrecio([mp({ idListaPrecios: null, listasPorForma: { debito: "L5" } })], false);
    const r = armarPreciosMedios(precios, null, sel);
    expect(r.preciosMedios?.map((p) => p.forma)).toEqual(["debito"]);
  });

  it("ficha: si todas las formas cuestan lo mismo, una sola línea sin rótulo de forma", () => {
    const iguales = seleccionarMediosPrecio([mp({ idListaPrecios: "L5", listasPorForma: { debito: "L5", credito: "L5" } })], false);
    const r = armarPreciosMedios(precios, null, iguales);
    expect(r.preciosMedios).toEqual([{ slug: "mercadopago", nombre: "MERCADOPAGO", price: 80000 }]);
  });

  it("claves de caché distintas: el medio serializado cambia con las listas por forma", () => {
    const a = seleccionarMediosPrecio([mp({ idListaPrecios: "L1", listasPorForma: { debito: "L5" } })], false);
    const b = seleccionarMediosPrecio([mp({ idListaPrecios: "L1", listasPorForma: { debito: "L6" } })], false);
    const c = seleccionarMediosPrecio([mp({ idListaPrecios: "L1" })], false);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("con el flag precio-especial-cuenta encendido no se exhibe nada, tampoco por forma", () => {
    expect(seleccionarMediosPrecio([mp({ listasPorForma: { debito: "L5" } })], true)).toEqual({ destacado: null, ficha: [] });
  });
});

describe("medios sin cobro en línea en el modal", () => {
  const precios = [
    { idPriceList: "REF", name: "Ref", price: 100000, main: true },
    { idPriceList: "TRF", name: "Transf", price: 90000 },
    { idPriceList: "CARA", name: "Cara", price: 130000 },
  ];
  const transf = (extra: Partial<MedioPago> = {}) =>
    medio("transferencia", { nombre: "Transferencia bancaria", idListaPrecios: "TRF", orden: 1, ...extra });

  it("con transferencia: bloque con el precio de su lista, sin depender de mostrarEnFicha", () => {
    const sel = seleccionarMediosPrecio([transf({ mostrarEnFicha: false, destacarEnCatalogo: false })], false);
    expect(sel.ficha).toHaveLength(0);
    const r = armarPreciosMedios(precios, 21, sel);
    expect(r.preciosOfflineModal).toEqual([{ slug: "transferencia", nombre: "Transferencia bancaria", precioFinal: 108900 }]);
  });

  it("sin lista o con lista más cara que la de referencia: precio de referencia; respeta el orden", () => {
    const sel = seleccionarMediosPrecio(
      [medio("efectivo", { nombre: "Efectivo", idListaPrecios: null, orden: 2 }), transf({ idListaPrecios: "CARA", orden: 1 })],
      false,
    );
    const r = armarPreciosMedios(precios, 21, sel);
    expect(r.preciosOfflineModal?.map((x) => [x.slug, x.precioFinal])).toEqual([
      ["transferencia", 121000],
      ["efectivo", 121000],
    ]);
  });

  it("cuenta corriente, inactivos, cobro en línea, reservados y sin retiro ni envío quedan afuera", () => {
    const sel = seleccionarMediosPrecio(
      [
        transf({ audiencia: "cuenta_corriente" }),
        medio("inactivo", { activo: false }),
        medio("mercadopago", { cobroOnline: true }),
        medio("a_coordinar"),
        medio("nada", { aplicaRetiro: false, aplicaEnvio: false }),
      ],
      false,
    );
    expect(sel.offline).toBeUndefined();
    expect(armarPreciosMedios(precios, 21, sel).preciosOfflineModal).toBeUndefined();
  });

  it("sin medios offline el resultado no suma el campo", () => {
    const sel = seleccionarMediosPrecio([medio("mercadopago", { cobroOnline: true, listasPorForma: { debito: "L5" } })], false);
    expect(sel.offline).toBeUndefined();
  });
});
