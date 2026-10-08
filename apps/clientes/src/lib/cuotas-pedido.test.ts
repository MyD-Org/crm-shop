import { describe, expect, it } from "vitest";
import { combinarOpcionesCuotas } from "./cuotas-pedido";
import type { PlanesMP, PlanMP } from "./pagos/mercadopago-planes";

const sinInteres = [
  { cuotas: 1, total: 50_000, montoCuota: 50_000 },
  { cuotas: 3, total: 52_000, montoCuota: 17_333.34 },
  { cuotas: 6, total: 54_000, montoCuota: 9_000 },
];
const condiciones = [
  { cuotas: 3, idListaPrecios: "l3", marcas: null },
  { cuotas: 6, idListaPrecios: "l6", marcas: ["visa", "mastercard"] },
];
const plan = (cuotas: number, total: number, conInteres = true): PlanMP => ({
  cuotas,
  montoCuota: Math.round((total / cuotas) * 100) / 100,
  total,
  tasaPct: conInteres ? 10 : 0,
  cft: conInteres ? "169,00" : null,
  tea: conInteres ? "130,00" : null,
  conInteres,
});
const planes = (...p: PlanMP[]): PlanesMP => ({ metodoPagoId: "visa", emisor: null, logo: null, planes: p });

const resumen = (r: ReturnType<typeof combinarOpcionesCuotas>) =>
  r.opciones.map((o) => `${o.cuotas}:${o.tipo}:${o.pedidoCuotas}`);

describe("combinarOpcionesCuotas", () => {
  it("sin tarjeta cargada: 1 pago, sin interés sin restricción y con interés de referencia; sin avisos de marcas", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: null,
      tarjetaCargada: false,
      planes: planes(plan(3, 59_845), plan(6, 66_070), plan(12, 77_695)),
      planesDeLaTarjeta: false,
    });
    // 6 sin interés está restringida a Visa/Master: sin tarjeta no se ofrece como sin interés.
    expect(resumen(r)).toEqual(["1:un_pago:1", "3:sin_interes:3", "6:con_interes:1", "12:con_interes:1"]);
    expect(r.restringidas).toEqual([]);
  });

  it("orden por cuotas; con interés trae total, cuota y CFT/TEA de MP y deja el pedido en 1 pago", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: "visa",
      tarjetaCargada: true,
      planes: planes(plan(12, 77_695)),
      planesDeLaTarjeta: true,
    });
    expect(r.opciones.map((o) => o.cuotas)).toEqual([1, 3, 6, 12]);
    expect(r.opciones.at(-1)).toEqual({
      clave: "con_interes-12",
      cuotas: 12,
      tipo: "con_interes",
      montoCuota: 6474.58,
      total: 77_695,
      cft: "169,00",
      tea: "130,00",
      pedidoCuotas: 1,
    });
    expect(r.opciones.find((o) => o.cuotas === 6)).toMatchObject({ tipo: "sin_interes", total: 54_000, pedidoCuotas: 6 });
  });

  it("marca no incluida: la cuota sin interés no se ofrece y va a restringidas (con sus marcas)", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: "amex",
      tarjetaCargada: true,
      planes: null,
      planesDeLaTarjeta: false,
    });
    expect(resumen(r)).toEqual(["1:un_pago:1", "3:sin_interes:3"]);
    expect(r.restringidas).toEqual([{ cuotas: 6, marcas: ["visa", "mastercard"] }]);
  });

  it("tarjeta cargada de marca desconocida: sólo las sin restricción", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: null,
      tarjetaCargada: true,
      planes: null,
      planesDeLaTarjeta: false,
    });
    expect(resumen(r)).toEqual(["1:un_pago:1", "3:sin_interes:3"]);
    expect(r.restringidas).toEqual([{ cuotas: 6, marcas: ["visa", "mastercard"] }]);
  });

  it("control (a): MP informa interés para una cuota 'sin interés' de la tienda con ESA tarjeta → se ofrece como con interés", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: "visa",
      tarjetaCargada: true,
      planes: planes(plan(3, 59_845)),
      planesDeLaTarjeta: true,
    });
    expect(r.opciones.find((o) => o.cuotas === 3)).toMatchObject({ tipo: "con_interes", total: 59_845, pedidoCuotas: 1 });
  });

  it("los planes de referencia (sin tarjeta) no aplican el control (a)", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: null,
      tarjetaCargada: false,
      planes: planes(plan(3, 59_845)),
      planesDeLaTarjeta: false,
    });
    expect(r.opciones.find((o) => o.cuotas === 3)).toMatchObject({ tipo: "sin_interes", pedidoCuotas: 3 });
  });

  it("plan de MP con tasa 0 (sin interés a cargo del vendedor): sin interés al precio de 1 pago, pedido en 1 pago", () => {
    const r = combinarOpcionesCuotas({
      sinInteres: sinInteres.slice(0, 1),
      condiciones: [],
      marca: "visa",
      tarjetaCargada: true,
      planes: planes(plan(9, 50_000, false)),
      planesDeLaTarjeta: true,
    });
    expect(r.opciones.find((o) => o.cuotas === 9)).toEqual({
      clave: "sin_interes-9",
      cuotas: 9,
      tipo: "sin_interes",
      montoCuota: 5_555.56,
      total: 50_000,
      pedidoCuotas: 1,
    });
  });

  it("sin planes (MP caído, Payway o débito): 1 pago y sin interés", () => {
    const r = combinarOpcionesCuotas({
      sinInteres,
      condiciones,
      marca: "visa",
      tarjetaCargada: true,
      planes: null,
      planesDeLaTarjeta: false,
    });
    expect(resumen(r)).toEqual(["1:un_pago:1", "3:sin_interes:3", "6:sin_interes:6"]);
  });
});
