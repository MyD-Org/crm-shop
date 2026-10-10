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

  it("medio sin precios por forma: forma null (no se congela) y la lista del medio", async () => {
    const r = await llamar(medio({}), { formaPedida: "debito" });
    expect(r).toMatchObject({ ok: true, formaCobro: null, idListaMedio: "A" });
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
