import { describe, expect, it } from "vitest";
import type { MedioPago } from "./medios-pago";
import { formaInicialDelMedio, hayPreciosPorForma, idListaDelMedio, listaDelPagoUnico, pagoParaCotizar, resolverForma } from "./lista-medio";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia",
  nombre: "Transferencia",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: "7",
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

describe("idListaDelMedio", () => {
  it("devuelve la lista del medio activo aplicable", () => {
    expect(idListaDelMedio([medio({})], "retiro", "transferencia")).toBe("7");
  });

  it("undefined si el medio no tiene lista", () => {
    expect(idListaDelMedio([medio({ idListaPrecios: null })], "retiro", "transferencia")).toBeUndefined();
  });

  it("undefined si el slug no existe", () => {
    expect(idListaDelMedio([medio({})], "retiro", "otro")).toBeUndefined();
  });

  it("undefined si el medio está inactivo", () => {
    expect(idListaDelMedio([medio({ activo: false })], "retiro", "transferencia")).toBeUndefined();
  });

  it("undefined si no aplica a la modalidad", () => {
    const m = medio({ aplicaEnvio: false });
    expect(idListaDelMedio([m], "envio", "transferencia")).toBeUndefined();
    expect(idListaDelMedio([m], "retiro", "transferencia")).toBe("7");
  });

  it("undefined para a_coordinar", () => {
    expect(idListaDelMedio([medio({ slug: "a_coordinar" })], "retiro", "a_coordinar")).toBeUndefined();
  });

  it("undefined con slug vacío o ausente (la lista sale solo del slug)", () => {
    expect(idListaDelMedio([medio({})], "retiro", "")).toBeUndefined();
    expect(idListaDelMedio([medio({})], "retiro", undefined)).toBeUndefined();
  });
});

describe("pagoParaCotizar", () => {
  const A = medio({ slug: "a", orden: 1, idListaPrecios: "9" });
  const B = medio({ slug: "b", orden: 2, idListaPrecios: "9" });
  const C = medio({ slug: "c", orden: 3, idListaPrecios: "5" });
  const D = medio({ slug: "d", orden: 4, idListaPrecios: null });
  const E = medio({ slug: "e", orden: 5, idListaPrecios: null });
  const todos = [A, B, C, D, E];

  it("la clave es la lista, no el slug: medios con la misma lista no refetchean", () => {
    expect(pagoParaCotizar(todos, "retiro", A)).toEqual(pagoParaCotizar(todos, "retiro", B));
    expect(pagoParaCotizar(todos, "retiro", B).pagoMetodo).toBe("a");
  });

  it("medios sin lista comparten clave vacía y no mandan slug", () => {
    expect(pagoParaCotizar(todos, "retiro", D)).toEqual({ listaKey: "", pagoMetodo: undefined });
    expect(pagoParaCotizar(todos, "retiro", E)).toEqual(pagoParaCotizar(todos, "retiro", D));
    expect(pagoParaCotizar(todos, "retiro", null)).toEqual({ listaKey: "", pagoMetodo: undefined });
  });

  it("listas distintas dan claves distintas", () => {
    expect(pagoParaCotizar(todos, "retiro", C).listaKey).toBe("5");
    expect(pagoParaCotizar(todos, "retiro", A).listaKey).not.toBe("5");
  });
});

describe("idListaDelMedio con cuotas sin interés (rebanada D)", () => {
  const mp = medio({
    slug: "mercadopago",
    cobroOnline: true,
    idListaPrecios: "L1",
    condicionesCuotas: [
      { cuotas: 3, idListaPrecios: "L3" },
      { cuotas: 6, idListaPrecios: "L6" },
    ],
  });

  it("N cuotas toma la lista de ESA condición, no la del pago único", () => {
    expect(idListaDelMedio([mp], "retiro", "mercadopago", undefined, 6)).toBe("L6");
    expect(idListaDelMedio([mp], "retiro", "mercadopago", undefined, 3)).toBe("L3");
  });

  it("un pago (1 o sin cuotas) usa la lista del pago único", () => {
    expect(idListaDelMedio([mp], "retiro", "mercadopago", undefined, 1)).toBe("L1");
    expect(idListaDelMedio([mp], "retiro", "mercadopago")).toBe("L1");
    expect(idListaDelMedio([mp], "retiro", "mercadopago", undefined, null)).toBe("L1");
  });

  it("una cantidad sin condición no inventa lista: undefined (rige la referencia)", () => {
    expect(idListaDelMedio([mp], "retiro", "mercadopago", undefined, 12)).toBeUndefined();
  });

  it("sin lista de pago único pero con condiciones: un pago rige la referencia, N cuotas su lista", () => {
    const sinUnico = { ...mp, idListaPrecios: null };
    expect(idListaDelMedio([sinUnico], "retiro", "mercadopago", undefined, 1)).toBeUndefined();
    expect(idListaDelMedio([sinUnico], "retiro", "mercadopago", undefined, 6)).toBe("L6");
  });

  it("sólo cuenta si el medio aplica a la modalidad y está activo", () => {
    expect(idListaDelMedio([{ ...mp, activo: false }], "retiro", "mercadopago", undefined, 6)).toBeUndefined();
    expect(idListaDelMedio([{ ...mp, aplicaEnvio: false }], "envio", "mercadopago", undefined, 6)).toBeUndefined();
  });

  it("sin credenciales de Mercado Pago el medio no aplica: sin lista", () => {
    expect(idListaDelMedio([mp], "retiro", "mercadopago", { mpDisponible: false }, 6)).toBeUndefined();
  });
});

// --- Listas por forma de pago (change `listas-por-forma-de-pago`, rebanada C) ---

const mp = (o: Partial<MedioPago> = {}): MedioPago =>
  medio({ slug: "mercadopago", nombre: "Mercado Pago", cobroOnline: true, idListaPrecios: "A", ...o });
const payway = (o: Partial<MedioPago> = {}): MedioPago =>
  medio({ slug: "payway", nombre: "Payway", cobroOnline: true, idListaPrecios: "A", ...o });

describe("listaDelPagoUnico / idListaDelMedio con forma", () => {
  const m = mp({ listasPorForma: { debito: "B" } });

  it("precedencia: la de la forma > la del medio (forma NULL) > la general", () => {
    expect(listaDelPagoUnico(m, "debito")).toBe("B");
    expect(listaDelPagoUnico(m, "credito")).toBe("A");
    expect(listaDelPagoUnico(mp({ idListaPrecios: null }), "credito")).toBeUndefined();
  });

  it("sin forma NUNCA toma una lista por forma", () => {
    expect(listaDelPagoUnico(m)).toBe("A");
    expect(listaDelPagoUnico(m, null)).toBe("A");
    expect(idListaDelMedio([m], "retiro", "mercadopago")).toBe("A");
  });

  it("idListaDelMedio con forma: débito B, crédito A", () => {
    expect(idListaDelMedio([m], "retiro", "mercadopago", undefined, 1, "debito")).toBe("B");
    expect(idListaDelMedio([m], "retiro", "mercadopago", undefined, 1, "credito")).toBe("A");
  });

  it("las cuotas (N >= 2) ignoran la forma", () => {
    const conCuotas = mp({
      listasPorForma: { debito: "B" },
      condicionesCuotas: [{ cuotas: 3, idListaPrecios: "C" } as never],
    });
    expect(idListaDelMedio([conCuotas], "retiro", "mercadopago", undefined, 3, "debito")).toBe("C");
  });

  it("Payway débito usa su lista; crédito la del medio", () => {
    const p = payway({ listasPorForma: { debito: "B" } });
    expect(idListaDelMedio([p], "retiro", "payway", undefined, 1, "debito")).toBe("B");
    expect(idListaDelMedio([p], "retiro", "payway", undefined, 1, "credito")).toBe("A");
  });
});

describe("hayPreciosPorForma", () => {
  it("false sin listas por forma, MP y Payway", () => {
    expect(hayPreciosPorForma(mp())).toBe(false);
    expect(hayPreciosPorForma(payway())).toBe(false);
  });

  it("true si alguna forma tiene una lista distinta de la del medio", () => {
    expect(hayPreciosPorForma(mp({ listasPorForma: { debito: "B" } }))).toBe(true);
    expect(hayPreciosPorForma(payway({ listasPorForma: { debito: "B" } }))).toBe(true);
  });

  it("false si la forma apunta a la misma lista del medio", () => {
    expect(hayPreciosPorForma(mp({ listasPorForma: { debito: "A" } }))).toBe(false);
  });

  it("solo cuentan las formas habilitadas del medio", () => {
    // Solo crédito habilitado: la fila de débito no se ofrece, no hay dos precios posibles.
    expect(hayPreciosPorForma(mp({ opcionesCobro: ["credito"], listasPorForma: { debito: "B" } }))).toBe(false);
  });

  it("Payway ignora una fila cuenta_mp", () => {
    expect(hayPreciosPorForma(payway({ listasPorForma: { cuenta_mp: "B" } }))).toBe(false);
  });

  it("false para un medio que no es de Mercado Pago ni de Payway", () => {
    expect(hayPreciosPorForma(medio({ listasPorForma: { debito: "B" } }))).toBe(false);
  });
});

describe("resolverForma", () => {
  const conPrecios = mp({ listasPorForma: { debito: "B" } });

  it("sin precios por forma: forma null (también con una forma válida pedida)", () => {
    expect(resolverForma(mp(), undefined)).toEqual({ ok: true, forma: null, pedida: null });
    expect(resolverForma(mp(), "debito")).toEqual({ ok: true, forma: null, pedida: "debito" });
  });

  it("con precios: la pedida", () => {
    expect(resolverForma(conPrecios, "debito")).toEqual({ ok: true, forma: "debito", pedida: "debito" });
  });

  it("con precios y sin forma pedida: la primera que ofrece el medio (crédito)", () => {
    expect(resolverForma(conPrecios, undefined)).toEqual({ ok: true, forma: "credito", pedida: null });
    const sinCredito = mp({ opcionesCobro: ["debito", "cuenta_mp"], listasPorForma: { debito: "B" } });
    expect(resolverForma(sinCredito, null)).toMatchObject({ ok: true, forma: "debito" });
  });

  it("forma inválida o no habilitada: rechazada", () => {
    expect(resolverForma(conPrecios, "efectivo")).toEqual({ ok: false });
    expect(resolverForma(conPrecios, 3)).toEqual({ ok: false });
    expect(resolverForma(mp({ opcionesCobro: ["credito", "debito"], listasPorForma: { debito: "B" } }), "cuenta_mp")).toEqual({
      ok: false,
    });
  });

  it("Payway: cuenta_mp rechazada siempre; crédito y débito válidas", () => {
    const p = payway({ listasPorForma: { debito: "B" } });
    expect(resolverForma(p, "cuenta_mp")).toEqual({ ok: false });
    expect(resolverForma(payway(), "cuenta_mp")).toEqual({ ok: false });
    expect(resolverForma(p, "debito")).toMatchObject({ ok: true, forma: "debito" });
    expect(resolverForma(p, "credito")).toMatchObject({ ok: true, forma: "credito" });
  });

  it("un medio que no es de Mercado Pago ni de Payway ignora la forma", () => {
    expect(resolverForma(medio({}), "debito")).toEqual({ ok: true, forma: null, pedida: null });
    expect(resolverForma(medio({}), "efectivo")).toEqual({ ok: true, forma: null, pedida: null });
  });
});

describe("pagoParaCotizar con forma", () => {
  const m = mp({ listasPorForma: { debito: "B" } });

  it("la clave sigue a la lista de la forma; la forma viaja solo si su lista difiere de la del medio", () => {
    expect(pagoParaCotizar([m], "retiro", m, undefined, "debito")).toEqual({
      listaKey: "B",
      pagoMetodo: "mercadopago",
      formaKey: "debito",
    });
    const credito = pagoParaCotizar([m], "retiro", m, undefined, "credito");
    expect(credito).toEqual({ listaKey: "A", pagoMetodo: "mercadopago" });
    expect(credito.formaKey).toBeUndefined();
  });

  it("sin forma, igual que antes", () => {
    expect(pagoParaCotizar([m], "retiro", m)).toEqual({ listaKey: "A", pagoMetodo: "mercadopago" });
  });
});

describe("formaInicialDelMedio (la forma con la que nace el pedido)", () => {
  it("sin precios distintos por forma: null (el pedido no valida la forma)", () => {
    expect(formaInicialDelMedio(mp())).toBeNull();
    expect(formaInicialDelMedio(mp({ listasPorForma: { debito: "A" } }))).toBeNull();
  });

  it("con precios distintos: la primera forma que el medio ofrece, la misma que elige resolverForma", () => {
    const m = mp({ listasPorForma: { debito: "B" } });
    expect(formaInicialDelMedio(m)).toBe("credito");
    expect(resolverForma(m, undefined)).toMatchObject({ ok: true, forma: formaInicialDelMedio(m) });
    const soloDebito = mp({ opcionesCobro: ["debito", "cuenta_mp"], listasPorForma: { cuenta_mp: "B" } });
    expect(formaInicialDelMedio(soloDebito)).toBe("debito");
    expect(resolverForma(soloDebito, undefined)).toMatchObject({ ok: true, forma: "debito" });
    expect(formaInicialDelMedio(payway({ listasPorForma: { debito: "B" } }))).toBe("credito");
  });
});
