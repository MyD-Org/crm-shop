import { describe, expect, it } from "vitest";
import {
  armarOferta,
  cuotasMaxPara,
  maxCuotas,
  mejorOpcion,
  opcionesPara,
  planPedido,
  proximoEscalon,
} from "./cuotas";
import type {
  EscalonCuotas,
  OfertaCuotas,
  OpcionCuotas,
  PlanDeCuotas,
  ProveedorConfigurado,
} from "./pagos/cuotas-tipos";

/**
 * Motor de cuotas v2 (config por proveedor): depende SÓLO de un monto base,
 * nunca del producto. El CRM define escalones {cuotasMax, montoMinimo}; el
 * proveedor define qué cantidades existen y su tasa (0 = sin interés).
 */

let seq = 0;
const escalon = (cuotasMax: number, montoMinimo: number): EscalonCuotas => ({
  id: `e-${++seq}`,
  cuotasMax,
  montoMinimo,
});

function proveedor(p: Partial<ProveedorConfigurado> = {}): ProveedorConfigurado {
  return {
    id: "p-mp",
    proveedor: "mercadopago",
    nombre: "Mercado Pago",
    activo: true,
    orden: 0,
    escalones: [escalon(3, 0), escalon(6, 180000)],
    ...p,
  };
}

function plan(p: Partial<PlanDeCuotas> & { cuotas: number }): PlanDeCuotas {
  return {
    proveedor: "mercadopago",
    medio: "visa",
    tasaPct: 0,
    cftPct: null,
    teaPct: null,
    montoMin: null,
    montoMax: null,
    ...p,
  };
}

/** Snapshot de una marca con 1, 3, 6, 9, 12 y 18 cuotas; tasa por cuotas (default 0). */
function planesPara(medio: string, tasas: Record<number, number> = {}): PlanDeCuotas[] {
  return [1, 3, 6, 9, 12, 18].map((c) =>
    plan({
      medio,
      cuotas: c,
      tasaPct: tasas[c] ?? 0,
      cftPct: tasas[c] ? tasas[c] * 2 : null,
      teaPct: tasas[c] ? tasas[c] : null,
    }),
  );
}

const cuotasDe = (o: OfertaCuotas, prov = "mercadopago") =>
  o.proveedores.find((p) => p.proveedor === prov)?.opciones.map((x) => x.cuotas) ?? [];

describe("cuotasMaxPara", () => {
  const escalones = [escalon(3, 0), escalon(6, 180000), escalon(12, 400000)];

  it("mayor cuotasMax con montoMinimo <= monto; el mínimo es inclusive", () => {
    expect(cuotasMaxPara(100000, escalones)).toBe(3);
    expect(cuotasMaxPara(179999.99, escalones)).toBe(3);
    expect(cuotasMaxPara(180000, escalones)).toBe(6);
    expect(cuotasMaxPara(1_000_000, escalones)).toBe(12);
  });

  it("ningún escalón alcanzado → 1 pago", () => {
    expect(cuotasMaxPara(1000, [escalon(6, 5000)])).toBe(1);
    expect(cuotasMaxPara(1000, [])).toBe(1);
  });

  it("no asume orden: toma el mayor aunque vengan desordenados", () => {
    expect(cuotasMaxPara(500000, [escalon(12, 400000), escalon(3, 0), escalon(6, 180000)])).toBe(12);
  });

  it("un escalón posterior con menos cuotas no baja el máximo", () => {
    expect(cuotasMaxPara(500000, [escalon(12, 100000), escalon(6, 400000)])).toBe(12);
  });

  it("monto inválido → 1", () => {
    expect(cuotasMaxPara(Number.NaN, escalones)).toBe(1);
    expect(cuotasMaxPara(-5, [escalon(6, 0)])).toBe(1);
  });
});

describe("armarOferta", () => {
  it("junta las marcas por cantidad de cuotas con la tasa más alta y omite 1 pago", () => {
    const o = armarOferta(
      [proveedor()],
      [...planesPara("visa", { 12: 30 }), ...planesPara("master", { 12: 35, 6: 0 })],
    );
    const p = o.proveedores[0];
    expect(p.opciones.map((x) => x.cuotas)).toEqual([3, 6, 9, 12, 18]);
    expect(p.opciones.find((x) => x.cuotas === 12)).toMatchObject({
      tasaPct: 35,
      cftPct: 70,
      teaPct: 35,
      sinInteres: false,
    });
    expect(p.opciones.find((x) => x.cuotas === 6)?.sinInteres).toBe(true);
  });

  it("una cantidad que sólo trae una marca también se ofrece", () => {
    const o = armarOferta([proveedor()], [plan({ cuotas: 3 }), plan({ medio: "master", cuotas: 24, tasaPct: 50 })]);
    expect(cuotasDe(o)).toEqual([3, 24]);
  });

  it("rango de montos: el más restrictivo entre marcas", () => {
    const o = armarOferta(
      [proveedor()],
      [plan({ cuotas: 6, montoMin: 100, montoMax: 900000 }), plan({ medio: "master", cuotas: 6, montoMin: 500, montoMax: null })],
    );
    expect(o.proveedores[0].opciones[0]).toMatchObject({ montoMin: 500, montoMax: 900000 });
  });

  it("sin interés = tasa 0 del proveedor; cualquier tasa > 0 es con interés", () => {
    const o = armarOferta([proveedor()], planesPara("visa", { 3: 0.01 }));
    expect(o.proveedores[0].opciones.find((x) => x.cuotas === 3)?.sinInteres).toBe(false);
    expect(o.proveedores[0].opciones.find((x) => x.cuotas === 6)?.sinInteres).toBe(true);
  });

  it("sólo cruza planes del mismo proveedor", () => {
    const o = armarOferta([proveedor()], [plan({ proveedor: "otro", cuotas: 6 }), plan({ cuotas: 3 })]);
    expect(cuotasDe(o)).toEqual([3]);
  });

  it("omite proveedores inactivos y ordena por `orden`", () => {
    const o = armarOferta(
      [
        proveedor({ id: "a", proveedor: "mercadopago", orden: 2 }),
        proveedor({ id: "b", proveedor: "otro", nombre: "Otro", orden: 1 }),
        proveedor({ id: "c", proveedor: "apagado", activo: false }),
      ],
      [plan({ cuotas: 3 }), plan({ proveedor: "otro", cuotas: 3 }), plan({ proveedor: "apagado", cuotas: 3 })],
    );
    expect(o.proveedores.map((p) => p.proveedor)).toEqual(["otro", "mercadopago"]);
  });

  it("proveedor sin snapshot queda con opciones vacías pero conserva sus escalones", () => {
    const o = armarOferta([proveedor()], []);
    expect(o.proveedores[0]).toMatchObject({ opciones: [], escalones: [{ cuotasMax: 3, montoMinimo: 0 }, { cuotasMax: 6, montoMinimo: 180000 }] });
  });

  it("ignora escalones y planes corruptos sin tirar; ordena escalones por monto", () => {
    const escalones = [
      escalon(6, 180000),
      escalon(0, 0),
      escalon(25, 0),
      escalon(2.5, 0),
      escalon("6" as unknown as number, 0),
      escalon(12, -1),
      escalon(12, Number.NaN),
      escalon(3, 0),
    ];
    const planes = [plan({ cuotas: 3 }), plan({ cuotas: 12, tasaPct: Number.NaN }), plan({ cuotas: 30 }), plan({ cuotas: 6, cftPct: "x" as unknown as number })];
    expect(() => armarOferta([proveedor({ escalones })], planes)).not.toThrow();
    const o = armarOferta([proveedor({ escalones })], planes);
    expect(o.proveedores[0].escalones).toEqual([
      { cuotasMax: 3, montoMinimo: 0 },
      { cuotasMax: 6, montoMinimo: 180000 },
    ]);
    expect(cuotasDe(o)).toEqual([3]);
  });

  it("es serializable y sin metadatos hasta que los ponga quien lee la DB", () => {
    const o = armarOferta([proveedor()], planesPara("visa"));
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(o).toMatchObject({ planesFetchedAt: null, configVersion: null });
  });
});

describe("opcionesPara", () => {
  const oferta = armarOferta([proveedor()], [...planesPara("visa", { 9: 20, 12: 30 }), ...planesPara("master")]);

  it("todas las cantidades del snapshot hasta el máximo del escalón", () => {
    expect(opcionesPara(100000, oferta).map((o) => o.cuotas)).toEqual([3]);
    expect(opcionesPara(180000, oferta).map((o) => o.cuotas)).toEqual([3, 6]);
  });

  it("con máximo 12 muestra también las con interés intermedias", () => {
    const o = armarOferta(
      [proveedor({ escalones: [escalon(12, 0)] })],
      planesPara("visa", { 9: 20, 12: 30 }),
    );
    expect(opcionesPara(120000, o).map((x) => [x.cuotas, x.sinInteres])).toEqual([
      [3, true],
      [6, true],
      [9, false],
      [12, false],
    ]);
  });

  it("con interés: $120.000 en 12 cuotas al 20%", () => {
    const o = armarOferta([proveedor({ escalones: [escalon(12, 0)] })], [plan({ cuotas: 12, tasaPct: 20, cftPct: 40, teaPct: 20 })]);
    expect(opcionesPara(120000, o)).toEqual([
      {
        proveedor: "mercadopago",
        proveedorNombre: "Mercado Pago",
        cuotas: 12,
        montoCuota: 12000,
        total: 144000,
        precioContado: 120000,
        cftPct: 40,
        teaPct: 20,
        sinInteres: false,
      },
    ]);
  });

  it("sin interés: total = base", () => {
    const [op] = opcionesPara(60000, oferta);
    expect(op).toMatchObject({ cuotas: 3, montoCuota: 20000, total: 60000, sinInteres: true });
  });

  it("respeta el rango de monto del proveedor", () => {
    const o = armarOferta(
      [proveedor({ escalones: [escalon(6, 0)] })],
      [plan({ cuotas: 6, montoMin: 1000, montoMax: 500000 })],
    );
    expect(opcionesPara(999, o)).toHaveLength(0);
    expect(opcionesPara(500001, o)).toHaveLength(0);
    expect(opcionesPara(1000, o)).toHaveLength(1);
  });

  it("ningún escalón alcanzado → sin opciones (sólo 1 pago)", () => {
    const o = armarOferta([proveedor({ escalones: [escalon(6, 50000)] })], planesPara("visa"));
    expect(opcionesPara(49999, o)).toEqual([]);
  });

  it("mismo monto ⇒ mismo resultado; base inválida → nada", () => {
    expect(opcionesPara(250000, oferta)).toEqual(opcionesPara(250000, oferta));
    expect(opcionesPara(0, oferta)).toEqual([]);
    expect(opcionesPara(Number.NaN, oferta)).toEqual([]);
  });
});

function op(p: Partial<OpcionCuotas> & { cuotas: number; montoCuota: number }): OpcionCuotas {
  return {
    proveedor: "mercadopago",
    proveedorNombre: "Mercado Pago",
    total: p.montoCuota * p.cuotas,
    precioContado: 0,
    cftPct: null,
    teaPct: null,
    sinInteres: false,
    ...p,
  };
}

describe("mejorOpcion", () => {
  it("la mayor cantidad sin interés, aunque haya más cuotas con interés", () => {
    const mejor = mejorOpcion([
      op({ cuotas: 3, montoCuota: 40000, sinInteres: true }),
      op({ cuotas: 6, montoCuota: 20000, sinInteres: true }),
      op({ cuotas: 12, montoCuota: 11000 }),
    ]);
    expect(mejor).toMatchObject({ cuotas: 6, sinInteres: true });
  });

  it("sin ninguna sin interés: la mayor cantidad, con la cuota más baja en esa cantidad", () => {
    const mejor = mejorOpcion([
      op({ cuotas: 3, montoCuota: 5000 }),
      op({ proveedor: "a", cuotas: 12, montoCuota: 14000 }),
      op({ proveedor: "b", cuotas: 12, montoCuota: 13500 }),
    ]);
    expect(mejor).toMatchObject({ proveedor: "b", cuotas: 12, montoCuota: 13500 });
  });

  it("empate total: menor CFT (null al final), luego el orden de entrada", () => {
    expect(
      mejorOpcion([
        op({ proveedor: "a", cuotas: 12, montoCuota: 13500, cftPct: null }),
        op({ proveedor: "b", cuotas: 12, montoCuota: 13500, cftPct: 80 }),
        op({ proveedor: "c", cuotas: 12, montoCuota: 13500, cftPct: 60 }),
      ])?.proveedor,
    ).toBe("c");
    expect(
      mejorOpcion([
        op({ proveedor: "a", cuotas: 6, montoCuota: 10000, sinInteres: true }),
        op({ proveedor: "b", cuotas: 6, montoCuota: 10000, sinInteres: true }),
      ])?.proveedor,
    ).toBe("a");
  });

  it("nada disponible → null", () => {
    expect(mejorOpcion([])).toBeNull();
  });
});

describe("maxCuotas", () => {
  it("la mayor cantidad disponible; sin opciones → 1", () => {
    expect(maxCuotas([op({ cuotas: 3, montoCuota: 1 }), op({ cuotas: 12, montoCuota: 1 })])).toBe(12);
    expect(maxCuotas([])).toBe(1);
  });
});

describe("proximoEscalon", () => {
  const oferta = armarOferta(
    [proveedor({ escalones: [escalon(3, 0), escalon(6, 180000), escalon(12, 400000)] })],
    planesPara("visa", { 12: 30 }),
  );

  it("te faltan $60.000 para hasta 6 cuotas", () => {
    expect(proximoEscalon(120000, oferta)).toEqual({ cuotas: 6, montoMinimo: 180000, faltante: 60000 });
  });

  it("elige el escalón más cercano, no el de más cuotas", () => {
    expect(proximoEscalon(200000, oferta)).toEqual({ cuotas: 12, montoMinimo: 400000, faltante: 200000 });
  });

  it("ya alcanzó el último escalón → null", () => {
    expect(proximoEscalon(400000, oferta)).toBeNull();
  });

  it("un escalón que no habilita ninguna cantidad nueva del snapshot se saltea", () => {
    // Snapshot 1,3,6,9,12,18: el escalón de 8 no suma nada sobre 6.
    const o = armarOferta(
      [proveedor({ escalones: [escalon(6, 0), escalon(8, 100000), escalon(9, 200000)] })],
      planesPara("visa"),
    );
    expect(proximoEscalon(50000, o)).toEqual({ cuotas: 9, montoMinimo: 200000, faltante: 150000 });
  });

  it("informa la cantidad efectiva del snapshot, no el cuotasMax crudo", () => {
    const o = armarOferta(
      [proveedor({ escalones: [escalon(3, 0), escalon(10, 100000)] })],
      planesPara("visa"),
    );
    expect(proximoEscalon(50000, o)?.cuotas).toBe(9);
  });

  it("sin escalón base: desde 1 pago al primero", () => {
    const o = armarOferta([proveedor({ escalones: [escalon(3, 100000)] })], planesPara("visa"));
    expect(proximoEscalon(40000, o)).toEqual({ cuotas: 3, montoMinimo: 100000, faltante: 60000 });
  });

  it("proveedor sin snapshot → null (no se promete lo que no se puede mostrar)", () => {
    const o = armarOferta([proveedor()], []);
    expect(proximoEscalon(100000, o)).toBeNull();
  });

  it("descarta escalones inalcanzables por el máximo del proveedor", () => {
    const o = armarOferta(
      [proveedor({ escalones: [escalon(3, 0), escalon(6, 180000)] })],
      [plan({ cuotas: 3 }), plan({ cuotas: 6, montoMax: 100000 })],
    );
    expect(proximoEscalon(50000, o)).toBeNull();
  });

  it("empate de monto mínimo entre proveedores → más cuotas", () => {
    const o = armarOferta(
      [
        proveedor({ escalones: [escalon(6, 150000)] }),
        proveedor({ id: "x", proveedor: "otro", orden: 1, escalones: [escalon(9, 150000)] }),
      ],
      [...planesPara("visa"), ...planesPara("visa").map((p) => ({ ...p, proveedor: "otro" }))],
    );
    expect(proximoEscalon(120000, o)).toMatchObject({ cuotas: 9 });
  });

  it("faltante redondeado hacia arriba al centavo", () => {
    const o = armarOferta([proveedor({ escalones: [escalon(6, 100.001)] })], planesPara("visa"));
    expect(proximoEscalon(100, o)?.faltante).toBe(0.01);
    const o2 = armarOferta([proveedor({ escalones: [escalon(6, 100.3)] })], planesPara("visa"));
    // 100.3 - 100.1 = 0.20000000000000284: un ceil ingenuo daría 0.21.
    expect(proximoEscalon(100.1, o2)?.faltante).toBe(0.2);
  });
});

describe("planPedido", () => {
  const oferta: OfertaCuotas = {
    ...armarOferta([proveedor()], planesPara("visa", { 12: 30 })),
    configVersion: "2026-09-17T10:00:00Z",
    planesFetchedAt: "2026-09-17T06:00:00Z",
  };

  it("oferta null → null (legacy)", () => {
    expect(planPedido(200000, null)).toBeNull();
  });

  it("pedido de $200.000 congela el máximo del escalón", () => {
    const p = planPedido(200000, oferta);
    expect(p).toMatchObject({
      version: "v2",
      proveedor: "mercadopago",
      configVersion: "2026-09-17T10:00:00Z",
      planesFetchedAt: "2026-09-17T06:00:00Z",
      totalBase: 200000,
      cuotasMax: 6,
    });
    expect(p?.opciones.map((o) => o.cuotas)).toEqual([3, 6]);
    expect(p).not.toHaveProperty("maxPorMedio");
  });

  it("se calcula sobre el total real: $179.000 queda en 3", () => {
    expect(planPedido(179000, oferta)?.cuotasMax).toBe(3);
  });

  it("el máximo sale de los escalones aunque el snapshot no tenga esa cantidad", () => {
    const o = armarOferta([proveedor({ escalones: [escalon(10, 0)] })], planesPara("visa"));
    expect(planPedido(50000, o)?.cuotasMax).toBe(10);
  });

  it("proveedor no configurado o ningún escalón alcanzado → cuotasMax 1", () => {
    expect(planPedido(50000, armarOferta([], []))).toMatchObject({ cuotasMax: 1, opciones: [] });
    const altos = armarOferta([proveedor({ escalones: [escalon(6, 500000)] })], planesPara("visa"));
    expect(planPedido(1000, altos)).toMatchObject({ cuotasMax: 1, opciones: [] });
  });

  it("sólo cuenta el proveedor del pedido", () => {
    const o = armarOferta(
      [proveedor({ escalones: [escalon(3, 0)] }), proveedor({ id: "x", proveedor: "otro", escalones: [escalon(12, 0)] })],
      planesPara("visa"),
    );
    expect(planPedido(50000, o)?.cuotasMax).toBe(3);
  });
});
