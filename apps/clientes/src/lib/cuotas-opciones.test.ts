import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cotizacion, LineaPedida } from "./cotizacion";
import type { MedioPago } from "./medios-pago";

const cotizarMock = vi.hoisted(() => vi.fn());
vi.mock("./cotizacion", async (original) => ({
  ...(await original<typeof import("./cotizacion")>()),
  cotizar: cotizarMock,
}));

import { baseParaCuotasCon, opcionesCuotasDePedido, opcionesSinInteresCotizadas } from "./cuotas-opciones";

/** Totales por lista (sin lista = la de referencia). */
const TOTALES: Record<string, number> = { ref: 100_000, l1: 90_000, l3: 100_000, l6: 120_000, l12: 150_000 };

const cot = (total: number, extra: Partial<Cotizacion> = {}): Cotizacion => ({
  lineas: [],
  subtotal: total,
  iva: 0,
  costoEnvio: 0,
  total,
  hayProblemas: false,
  listaPrivada: false,
  ...extra,
});

const condiciones = [
  { cuotas: 6, idListaPrecios: "l6", montoMinimo: 95_000 },
  { cuotas: 3, idListaPrecios: "l3" },
  { cuotas: 12, idListaPrecios: "l12", montoMinimo: 200_000 },
];

describe("opcionesSinInteresCotizadas", () => {
  const cotizarConLista = vi.fn(async (lista: string | undefined) => cot(TOTALES[lista ?? "ref"]));
  beforeEach(() => cotizarConLista.mockClear());

  it("una cotización por cantidad, cada una con SU lista; 1 pago con la del pago único", async () => {
    const r = await opcionesSinInteresCotizadas({
      condiciones,
      idListaUnPago: "l1",
      totalBase: undefined,
      cotizarConLista,
    });
    expect(cotizarConLista.mock.calls.map((c) => c[0]).sort()).toEqual(["l1", "l12", "l3", "l6"]);
    expect(r).toEqual([
      { cuotas: 1, total: 90_000, montoCuota: 90_000 },
      { cuotas: 3, total: 100_000, montoCuota: 33_333.34 },
      { cuotas: 6, total: 120_000, montoCuota: 20_000 },
      { cuotas: 12, total: 150_000, montoCuota: 12_500 },
    ]);
  });

  it("con base: sólo las cantidades cuyo mínimo alcanza", async () => {
    const r = await opcionesSinInteresCotizadas({ condiciones, idListaUnPago: "l1", totalBase: 99_000, cotizarConLista });
    expect(r.map((o) => o.cuotas)).toEqual([1, 3, 6]);
    expect(cotizarConLista.mock.calls.map((c) => c[0])).not.toContain("l12");
  });

  it("monto por cuota redondeado al centavo hacia arriba", async () => {
    const r = await opcionesSinInteresCotizadas({
      condiciones: [{ cuotas: 3, idListaPrecios: "l3" }],
      idListaUnPago: undefined,
      totalBase: undefined,
      cotizarConLista: async () => cot(100),
    });
    expect(r.find((o) => o.cuotas === 3)?.montoCuota).toBe(33.34);
  });

  it("una cotización con problemas o total 0 no se ofrece (nunca un monto inventado)", async () => {
    const r = await opcionesSinInteresCotizadas({
      condiciones,
      idListaUnPago: "l1",
      totalBase: undefined,
      cotizarConLista: async (lista) =>
        lista === "l3" ? cot(100_000, { hayProblemas: true }) : lista === "l6" ? cot(0) : cot(TOTALES[lista ?? "ref"]),
    });
    expect(r.map((o) => o.cuotas)).toEqual([1, 12]);
  });

  it("sin condiciones: sólo 1 pago", async () => {
    const r = await opcionesSinInteresCotizadas({ condiciones: null, idListaUnPago: undefined, totalBase: undefined, cotizarConLista });
    expect(r).toEqual([{ cuotas: 1, total: 100_000, montoCuota: 100_000 }]);
  });
});

describe("baseParaCuotasCon", () => {
  it("cotiza a la lista del pago único", async () => {
    expect(await baseParaCuotasCon(async (l) => cot(TOTALES[l ?? "ref"]), "l1")).toBe(90_000);
  });

  it("si esa lista no sirve (problemas), cae a la de referencia", async () => {
    const c = vi.fn(async (l: string | undefined) => (l ? cot(1, { hayProblemas: true }) : cot(TOTALES.ref)));
    expect(await baseParaCuotasCon(c, "l1")).toBe(100_000);
    expect(c.mock.calls.map((x) => x[0])).toEqual(["l1", undefined]);
  });

  it("si nada sirve: null (nunca se promete con base 0)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await baseParaCuotasCon(async () => { throw new Error("db"); }, "l1")).toBeNull();
    err.mockRestore();
  });
});

describe("opcionesCuotasDePedido (sobre las líneas del PEDIDO, no del carrito)", () => {
  const lineas: LineaPedida[] = [{ id: "item-1", qty: 2 }];
  const medio = {
    slug: "mercadopago",
    cobroOnline: true,
    condicionesCuotas: condiciones,
  } as unknown as MedioPago;

  beforeEach(() => {
    cotizarMock.mockReset();
    cotizarMock.mockImplementation(async (_l: LineaPedida[], o: { idListaMedio?: string }) =>
      cot(TOTALES[o.idListaMedio ?? "ref"]),
    );
  });

  it("pedido retomado: cotiza las líneas del pedido con las opciones del pedido", async () => {
    const r = await opcionesCuotasDePedido({
      lineas,
      medio,
      idListaUnPago: "l1",
      opcionesCotizar: { entregaTipo: "envio", soloVisibles: true },
    });
    for (const [l, o] of cotizarMock.mock.calls) {
      expect(l).toBe(lineas);
      expect(o).toMatchObject({ entregaTipo: "envio", soloVisibles: true });
    }
    // Base del mínimo: 90.000 a la lista del pago único → 6 (mín. 95.000) y 12 quedan afuera.
    expect(r.base).toBe(90_000);
    expect(r.opciones.map((o) => o.cuotas)).toEqual([1, 3]);
  });

  it("ignorarStock: un faltante de stock (el pedido ya reserva sus unidades) no saca la opción", async () => {
    const sinStock = (total: number) =>
      ({ id: "item-1", qty: 2, problema: "sin_stock", subtotal: total, iva: 0, total }) as unknown as Cotizacion["lineas"][number];
    cotizarMock.mockImplementation(async (_l: LineaPedida[], o: { idListaMedio?: string }) => {
      const total = TOTALES[o.idListaMedio ?? "ref"];
      return cot(total, { hayProblemas: true, lineas: [sinStock(total)] });
    });
    const sinIgnorar = await opcionesCuotasDePedido({
      lineas,
      medio,
      idListaUnPago: "l1",
      opcionesCotizar: { entregaTipo: "retiro", soloVisibles: false },
    });
    expect(sinIgnorar.opciones).toEqual([]);
    const ignorando = await opcionesCuotasDePedido({
      lineas,
      medio,
      idListaUnPago: "l1",
      opcionesCotizar: { entregaTipo: "retiro", soloVisibles: false },
      ignorarStock: true,
    });
    expect(ignorando.opciones.map((o) => o.cuotas)).toEqual([1, 3]);
  });

  it("sin mínimos cargados no cotiza la base aparte", async () => {
    const r = await opcionesCuotasDePedido({
      lineas,
      medio: { ...medio, condicionesCuotas: [{ cuotas: 3, idListaPrecios: "l3" }] } as MedioPago,
      idListaUnPago: "l1",
      opcionesCotizar: { entregaTipo: "retiro", soloVisibles: false },
    });
    expect(r.base).toBeNull();
    expect(cotizarMock).toHaveBeenCalledTimes(2);
    expect(r.opciones.map((o) => o.cuotas)).toEqual([1, 3]);
  });
});
