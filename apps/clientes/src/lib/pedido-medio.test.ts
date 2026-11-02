import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedioPago } from "./medios-pago";

/**
 * `cotizarConMedio` con la forma de pago (change `listas-por-forma-de-pago`, rebanada C): la forma la
 * resuelve el servidor, congela la lista de esa forma y las cuotas sin interés son solo de crédito.
 */

const cotizar = vi.fn();
let cuotasFlag = true;

vi.mock("./cotizacion", async (orig) => ({
  ...(await orig<typeof import("./cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("./cuotas-flag", () => ({ cuotasHabilitadas: async () => cuotasFlag }));

import { cotizarConMedio } from "./pedido-medio";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "mercadopago",
  nombre: "Mercado Pago",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: true,
  orden: 1,
  idListaPrecios: "A",
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

const MP = medio({
  listasPorForma: { debito: "B" },
  condicionesCuotas: [{ cuotas: 3, idListaPrecios: "C", montoMinimo: null, marcas: null }],
});
const PAYWAY = medio({ slug: "payway", nombre: "Payway", listasPorForma: { debito: "B" } });
const TRANSFERENCIA = medio({ slug: "transferencia", cobroOnline: false, listasPorForma: { debito: "B" } });

const llamar = (m: MedioPago, extra: Partial<Parameters<typeof cotizarConMedio>[0]> = {}) =>
  cotizarConMedio({
    lineas: [{ id: "1", qty: 1 }],
    entregaTipo: "retiro",
    pagoMetodo: m.slug,
    cuotasPedidas: undefined,
    mediosCrm: [m],
    opcionesMedios: {},
    idListaPrivada: null,
    soloVisibles: false,
    ...extra,
  });

beforeEach(() => {
  cotizar.mockReset();
  cotizar.mockImplementation(async () => ({ lineas: [], subtotal: 0, iva: 0, costoEnvio: 0, total: 100, hayProblemas: false }));
  cuotasFlag = true;
});

describe("cotizarConMedio con forma", () => {
  it("débito: cotiza con la lista de débito y congela la forma", async () => {
    const r = await llamar(MP, { formaPedida: "debito" });
    expect(r).toMatchObject({ ok: true, formaCobro: "debito", idListaMedio: "B" });
  });

  it("crédito: la lista del medio; sin forma pedida nace con la primera (crédito)", async () => {
    expect(await llamar(MP, { formaPedida: "credito" })).toMatchObject({ ok: true, formaCobro: "credito", idListaMedio: "A" });
    expect(await llamar(MP)).toMatchObject({ ok: true, formaCobro: "credito", idListaMedio: "A" });
  });

  it("medio sin precios por forma: congela la forma pedida y cotiza con la lista del medio", async () => {
    const r = await llamar(medio({}), { formaPedida: "debito" });
    expect(r).toMatchObject({ ok: true, formaCobro: "debito", idListaMedio: "A" });
    expect(await llamar(medio({}), {})).toMatchObject({ ok: true, formaCobro: null, idListaMedio: "A" });
  });

  it("forma inválida o no habilitada: forma_no_disponible", async () => {
    expect(await llamar(MP, { formaPedida: "efectivo" })).toEqual({ ok: false, motivo: "forma_no_disponible" });
    const sinCuentaMp = { ...MP, opcionesCobro: ["credito", "debito"] } as MedioPago;
    expect(await llamar(sinCuentaMp, { formaPedida: "cuenta_mp" })).toEqual({ ok: false, motivo: "forma_no_disponible" });
  });

  it("cuotas con débito: no disponibles; con crédito, la lista de las cuotas", async () => {
    expect(await llamar(MP, { formaPedida: "debito", cuotasPedidas: 3 })).toEqual({
      ok: false,
      motivo: "cuotas_no_disponibles",
    });
    expect(await llamar(MP, { formaPedida: "credito", cuotasPedidas: 3 })).toMatchObject({
      ok: true,
      formaCobro: "credito",
      cuotasPedido: 3,
      idListaMedio: "C",
    });
  });

  it("lista privada del comprador: la forma se ignora (el precio no depende del medio)", async () => {
    const r = await llamar(MP, { formaPedida: "debito", idListaPrivada: "privada" });
    expect(r).toMatchObject({ ok: true, formaCobro: null, idListaMedio: undefined });
    expect(await llamar(MP, { formaPedida: "cuenta_mp", idListaPrivada: "privada" })).toMatchObject({ ok: true });
  });

  it("medio sin cobro en línea (transferencia): ignora la forma", async () => {
    expect(await llamar(TRANSFERENCIA, { formaPedida: "debito" })).toMatchObject({
      ok: true,
      formaCobro: null,
      idListaMedio: "A",
    });
  });
});

describe("cotizarConMedio con forma en Payway", () => {
  it("congela crédito o débito con la lista de la modalidad", async () => {
    expect(await llamar(PAYWAY, { formaPedida: "debito" })).toMatchObject({ ok: true, formaCobro: "debito", idListaMedio: "B" });
    expect(await llamar(PAYWAY, { formaPedida: "credito" })).toMatchObject({ ok: true, formaCobro: "credito", idListaMedio: "A" });
  });

  it("rechaza cuenta_mp, con o sin precios por forma", async () => {
    expect(await llamar(PAYWAY, { formaPedida: "cuenta_mp" })).toEqual({ ok: false, motivo: "forma_no_disponible" });
    expect(await llamar(medio({ slug: "payway" }), { formaPedida: "cuenta_mp" })).toEqual({
      ok: false,
      motivo: "forma_no_disponible",
    });
  });

  it("débito con cuotas: no disponibles (débito es un solo pago)", async () => {
    expect(await llamar(PAYWAY, { formaPedida: "debito", cuotasPedidas: 6 })).toEqual({
      ok: false,
      motivo: "cuotas_no_disponibles",
    });
  });

  it("las cuotas sin interés de Payway siguen su regla con crédito", async () => {
    const conCuotas = { ...PAYWAY, condicionesCuotas: [{ cuotas: 6, idListaPrecios: "S", montoMinimo: null, marcas: null }] };
    expect(await llamar(conCuotas, { formaPedida: "credito", cuotasPedidas: 6 })).toMatchObject({
      ok: true,
      cuotasPedido: 6,
      idListaMedio: "S",
      formaCobro: "credito",
    });
  });
});

/**
 * Venta sin stock por modalidad: `aPedido` viaja a todas las cotizaciones (también a las del 409) y un
 * pedido a confirmar (`a_coordinar`, sin lista privada ni cuenta corriente) se cotiza con la lista que
 * muestran las cards (`idListaAConfirmar`), sin cuotas ni forma.
 */
describe("cotizarConMedio con venta sin stock", () => {
  const A_PEDIDO = new Set(["1"]);
  const conFlujo = (flujo: "normal" | "a_confirmar") =>
    cotizar.mockImplementation(async (_l, o: { idListaMedio?: string }) => ({
      lineas: [],
      subtotal: 0,
      iva: 0,
      costoEnvio: 0,
      total: o.idListaMedio === "lista-destacado" ? 90 : 100,
      hayProblemas: false,
      flujo,
    }));
  const aCoordinar = (extra: Partial<Parameters<typeof cotizarConMedio>[0]> = {}) =>
    cotizarConMedio({
      lineas: [{ id: "1", qty: 1 }],
      entregaTipo: "retiro",
      pagoMetodo: "a_coordinar",
      cuotasPedidas: 3,
      formaPedida: "debito",
      mediosCrm: [MP],
      opcionesMedios: { procesadorDisponible: () => true },
      idListaPrivada: null,
      soloVisibles: false,
      aPedido: A_PEDIDO,
      idListaAConfirmar: "lista-destacado",
      ...extra,
    });

  it("devuelve el flujo de la cotización y pasa aPedido a cotizar y a opcionesCotizar", async () => {
    conFlujo("normal");
    const r = await llamar(TRANSFERENCIA, { aPedido: A_PEDIDO });
    expect(r).toMatchObject({ ok: true, flujo: "normal" });
    expect(cotizar.mock.calls[0][1]).toMatchObject({ aPedido: A_PEDIDO });
    if (r.ok) expect(r.opcionesCotizar.aPedido).toBe(A_PEDIDO);
  });

  it("sin aPedido no agrega la clave (como hoy)", async () => {
    conFlujo("normal");
    const r = await llamar(TRANSFERENCIA);
    expect(cotizar.mock.calls[0][1]).not.toHaveProperty("aPedido");
    if (r.ok) expect(r.opcionesCotizar).not.toHaveProperty("aPedido");
  });

  it("a_coordinar + a_confirmar: recotiza con la lista del destacado, sin cuotas ni forma", async () => {
    conFlujo("a_confirmar");
    const r = await aCoordinar();
    expect(r).toMatchObject({
      ok: true,
      flujo: "a_confirmar",
      idListaMedio: "lista-destacado",
      cuotasPedido: null,
      formaCobro: null,
    });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.cotizacion.total).toBe(90);
    // Las recotizaciones del 409 usan la misma lista y las mismas líneas a pedido.
    expect(r.opcionesCotizar).toMatchObject({ idListaMedio: "lista-destacado", aPedido: A_PEDIDO });
    expect(cotizar.mock.calls.at(-1)?.[1]).toMatchObject({ idListaMedio: "lista-destacado", aPedido: A_PEDIDO });
  });

  it("no recotiza con la lista del destacado: flujo normal, otro medio, lista privada, cuenta corriente, pedido existente o sin lista", async () => {
    conFlujo("normal");
    expect(await aCoordinar()).toMatchObject({ ok: true, idListaMedio: undefined });
    conFlujo("a_confirmar");
    expect(await llamar(TRANSFERENCIA, { idListaAConfirmar: "lista-destacado", aPedido: A_PEDIDO })).toMatchObject({
      ok: true,
      flujo: "a_confirmar",
      idListaMedio: "A",
    });
    expect(await aCoordinar({ idListaPrivada: "privada" })).toMatchObject({ ok: true, idListaMedio: undefined });
    expect(await aCoordinar({ opcionesMedios: { esCuentaCorriente: true } })).toMatchObject({
      ok: true,
      idListaMedio: undefined,
    });
    expect(await aCoordinar({ ignorarStock: true })).toMatchObject({ ok: true, idListaMedio: undefined });
    expect(await aCoordinar({ idListaAConfirmar: undefined })).toMatchObject({ ok: true, idListaMedio: undefined });
    expect(cotizar.mock.calls.every((c) => c[1].idListaMedio !== "lista-destacado")).toBe(true);
  });
});

describe("cotizarConMedio con cupón", () => {
  const linea = (pu: number) => ({ id: "1", code: null, name: "x", brand: "", qty: 1, precioUnitario: pu, ivaPorcentaje: 0, subtotal: pu, iva: 0, total: pu, stockDisponible: 5 });
  const PRECIOS: Record<string, number> = { A: 1000, B: 900, C: 1100 };
  const promo = (o: Record<string, unknown> = {}) => ({
    codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot", tipo: "unicos" as const, pct: 10, envioGratis: false,
    provinciasEnvio: null, inicio: "2026-01-01T00:00:00-03:00", fin: "2099-01-01T00:00:00-03:00", venceEn: null,
    soloPrimeraCompra: true, minimo: null, medios: null, formas: null, permiteCuotas: false, limiteCanjes: null, condiciones: "", activa: true, ...o,
  });
  const cupon = (o: Record<string, unknown> = {}) => ({ promo: promo(o) as never, motivoCuenta: null, verificado: true });

  beforeEach(() => {
    cotizar.mockImplementation(async (_l: unknown, o: { idListaMedio?: string }) => {
      const pu = PRECIOS[o.idListaMedio ?? ""] ?? 1200;
      return { lineas: [linea(pu)], subtotal: pu, iva: 0, costoEnvio: 0, total: pu, hayProblemas: false, listaPrivada: false, flujo: "normal" };
    });
  });

  it("aplica el cupón sobre la lista que rige la elección", async () => {
    const r = await llamar(MP, { formaPedida: "debito", cupon: cupon() });
    expect(r.ok && r.cotizacion.total).toBe(810);
    expect(r.ok && r.cotizacion.cupon?.descuento).toBe(90);
  });

  it("cuotas sin interés con cupón sólo en 1 pago: sin descuento y con aviso", async () => {
    const r = await llamar(MP, { formaPedida: "credito", cuotasPedidas: 3, cupon: cupon() });
    expect(r.ok && r.cotizacion.total).toBe(1100);
    expect(r.ok && r.cotizacion.cuponError?.motivo).toBe("opcion_no_elegible");
  });

  it("mínimo: se mide a la lista general con una cotización extra", async () => {
    const r = await llamar(MP, { formaPedida: "debito", cupon: cupon({ minimo: 1201 }) });
    expect(r.ok && r.cotizacion.cuponError?.motivo).toBe("minimo");
    expect(cotizar.mock.calls.some(([, o]) => (o as { idListaMedio?: string }).idListaMedio === undefined)).toBe(true);
  });

  it("promoción con formas y medio sin precios por forma: la forma pedida queda congelada (el cobro la valida)", async () => {
    const r = await llamar(medio({}), { formaPedida: "debito", cupon: cupon({ formas: ["debito"] }) });
    expect(r.ok && r.cotizacion.cupon).toBeTruthy();
    expect(r.ok && r.formaCobro).toBe("debito");
  });

  it("promoción con formas y medio con formas sin forma conocida: no aplica (falla cerrado)", async () => {
    const r = await llamar(medio({}), { cupon: cupon({ formas: ["debito"] }) });
    expect(r.ok && r.cotizacion.cuponError?.motivo).toBe("opcion_no_elegible");
    expect(r.ok && r.cotizacion.total).toBe(1000);
  });

  it("congelado: no recotiza el mínimo ni mira la vigencia", async () => {
    const r = await llamar(MP, { formaPedida: "debito", cupon: { ...cupon({ minimo: 1e9, fin: "2026-01-02T00:00:00-03:00" }), congelado: true } });
    expect(r.ok && r.cotizacion.total).toBe(810);
    expect(cotizar.mock.calls.every(([, o]) => (o as { idListaMedio?: string }).idListaMedio !== undefined)).toBe(true);
  });
});
