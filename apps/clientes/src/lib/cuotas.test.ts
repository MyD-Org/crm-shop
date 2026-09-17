import { describe, expect, it } from "vitest";
import {
  armarOferta,
  hoyArgentina,
  maxCuotas,
  mejorOpcion,
  opcionesPara,
  planPedido,
  proximoEscalon,
} from "./cuotas";
import type {
  MedioDePago,
  OfertaCuotas,
  OpcionConfigurada,
  OpcionCuotas,
  PlanDeCuotas,
} from "./pagos/cuotas-tipos";

/**
 * Motor de cuotas (modelo Tiendanube): depende SÓLO de un monto base, nunca del
 * producto. Lo que decide acá es lo que se promete en card, ficha, carrito y
 * checkout, y lo que se congela en el pedido.
 */

const HOY = "2026-09-16";
const AYER = "2026-09-15";
const MANANA = "2026-09-17";

const visa: MedioDePago = {
  id: "m-visa",
  proveedor: "mercadopago",
  codigo: "visa",
  nombre: "Visa",
  activo: true,
  orden: 0,
};
const master: MedioDePago = {
  id: "m-master",
  proveedor: "mercadopago",
  codigo: "master",
  nombre: "Mastercard",
  activo: true,
  orden: 1,
};

let seq = 0;
function opcion(p: Partial<OpcionConfigurada> & { cuotas: number }): OpcionConfigurada {
  return {
    id: `o-${++seq}`,
    medioId: visa.id,
    sinInteres: false,
    montoMinimo: 0,
    vigenteDesde: null,
    vigenteHasta: null,
    activo: true,
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

/** Planes visa/master 1..24 con la tasa indicada por cuotas (default 0). */
function planesPara(medio: string, tasas: Record<number, number> = {}): PlanDeCuotas[] {
  return [1, 3, 6, 9, 12, 18, 24].map((c) =>
    plan({ medio, cuotas: c, tasaPct: tasas[c] ?? 0, cftPct: tasas[c] ? tasas[c] * 2 : 0, teaPct: tasas[c] ? tasas[c] : 0 }),
  );
}

const cuotasDe = (o: OfertaCuotas, medio = "visa") =>
  o.medios.find((m) => m.codigo === medio)?.opciones.map((x) => x.cuotas) ?? [];

describe("hoyArgentina", () => {
  it("usa la fecha de Argentina, no la UTC", () => {
    // 02:30 UTC del 17 = 23:30 del 16 en Buenos Aires.
    expect(hoyArgentina(new Date("2026-09-17T02:30:00Z"))).toBe("2026-09-16");
  });

  it("mediodía UTC es el mismo día", () => {
    expect(hoyArgentina(new Date("2026-09-16T12:00:00Z"))).toBe("2026-09-16");
  });
});

describe("armarOferta — disponibilidad", () => {
  const planes = planesPara("visa");

  it("descarta opciones inactivas o fuera de vigencia; el último día cuenta", () => {
    const o = armarOferta(
      [visa],
      [
        opcion({ cuotas: 3, activo: false }),
        opcion({ cuotas: 6, vigenteHasta: AYER }),
        opcion({ cuotas: 9, vigenteDesde: MANANA }),
        opcion({ cuotas: 12, vigenteDesde: AYER, vigenteHasta: HOY }),
      ],
      planes,
      HOY,
    );
    expect(cuotasDe(o)).toEqual([12]);
    expect(o.hoy).toBe(HOY);
  });

  it("omite medios inactivos", () => {
    const o = armarOferta(
      [{ ...visa, activo: false }, master],
      [opcion({ cuotas: 3 }), opcion({ cuotas: 3, medioId: master.id })],
      [...planes, ...planesPara("master")],
      HOY,
    );
    expect(o.medios.map((m) => m.codigo)).toEqual(["master"]);
  });

  it("la config sólo restringe: sin plan del proveedor la opción no existe", () => {
    const hasta12 = planes.filter((p) => p.cuotas <= 12);
    const o = armarOferta([visa], [opcion({ cuotas: 18 }), opcion({ cuotas: 6 })], hasta12, HOY);
    expect(cuotasDe(o)).toEqual([6]);
  });

  it("medio sin snapshot de planes queda sin opciones", () => {
    const o = armarOferta(
      [visa, master],
      [opcion({ cuotas: 3 }), opcion({ cuotas: 3, medioId: master.id })],
      planes,
      HOY,
    );
    expect(o.medios.map((m) => m.codigo)).toEqual(["visa"]);
  });

  it("ignora opciones y planes corruptos sin tirar", () => {
    const corruptas = [
      opcion({ cuotas: "abc" as unknown as number }),
      opcion({ cuotas: 1 }),
      opcion({ cuotas: 25 }),
      opcion({ cuotas: 2.5 }),
      opcion({ cuotas: 6, montoMinimo: -1 }),
      opcion({ cuotas: 9, vigenteHasta: "30/09/2026" }),
      opcion({ cuotas: 12 }),
      opcion({ cuotas: 3 }),
    ];
    const planesRotos = [
      ...planes.filter((p) => p.cuotas !== 12),
      plan({ cuotas: 12, tasaPct: Number.NaN }),
    ];
    expect(() => armarOferta([visa], corruptas, planesRotos, HOY)).not.toThrow();
    expect(cuotasDe(armarOferta([visa], corruptas, planesRotos, HOY))).toEqual([3]);
  });

  it("deduplica medio+cuotas: gana sin interés, luego menor monto mínimo", () => {
    const o = armarOferta(
      [visa],
      [
        opcion({ cuotas: 6, montoMinimo: 50000 }),
        opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 }),
        opcion({ cuotas: 3, montoMinimo: 90000 }),
        opcion({ cuotas: 3, montoMinimo: 10000 }),
      ],
      planes,
      HOY,
    );
    const ops = o.medios[0].opciones;
    expect(ops.map((x) => [x.cuotas, x.sinInteres, x.montoMinimo])).toEqual([
      [3, false, 10000],
      [6, true, 150000],
    ]);
  });

  it("ordena medios por `orden`", () => {
    const o = armarOferta(
      [{ ...visa, orden: 5 }, master],
      [opcion({ cuotas: 3 }), opcion({ cuotas: 3, medioId: master.id })],
      [...planes, ...planesPara("master")],
      HOY,
    );
    expect(o.medios.map((m) => m.codigo)).toEqual(["master", "visa"]);
  });
});

describe("armarOferta — sin interés con doble llave", () => {
  const sinInteresDe = (marcada: boolean, tasa: number) =>
    armarOferta([visa], [opcion({ cuotas: 6, sinInteres: marcada })], planesPara("visa", { 6: tasa }), HOY)
      .medios[0].opciones[0].sinInteres;

  it("marcada pero con tasa 15% → no es sin interés", () => {
    expect(sinInteresDe(true, 15)).toBe(false);
  });

  it("tasa 0 pero no marcada → no es sin interés", () => {
    expect(sinInteresDe(false, 0)).toBe(false);
  });

  it("marcada y tasa 0 → sin interés", () => {
    expect(sinInteresDe(true, 0)).toBe(true);
  });
});

describe("opcionesPara", () => {
  it("con interés: $120.000 en 6 cuotas al 20%", () => {
    const o = armarOferta([visa], [opcion({ cuotas: 6 })], planesPara("visa", { 6: 20 }), HOY);
    expect(opcionesPara(120000, o)).toEqual([
      {
        medio: "visa",
        medioNombre: "Visa",
        cuotas: 6,
        montoCuota: 24000,
        total: 144000,
        precioContado: 120000,
        cftPct: 40,
        teaPct: 20,
        sinInteres: false,
      },
    ]);
  });

  it("sin interés: total = base", () => {
    const o = armarOferta([visa], [opcion({ cuotas: 6, sinInteres: true })], planesPara("visa"), HOY);
    const [op] = opcionesPara(60000, o);
    expect(op).toMatchObject({ cuotas: 6, montoCuota: 10000, total: 60000, sinInteres: true });
  });

  it("marcada con tasa 15%: se presenta con la tasa real", () => {
    const o = armarOferta([visa], [opcion({ cuotas: 6, sinInteres: true })], planesPara("visa", { 6: 15 }), HOY);
    const [op] = opcionesPara(60000, o);
    expect(op.sinInteres).toBe(false);
    expect(op.total).toBe(69000);
    expect(op.cftPct).not.toBeNull();
    expect(op.teaPct).not.toBeNull();
  });

  it("monto mínimo inclusive", () => {
    const o = armarOferta([visa], [opcion({ cuotas: 6, montoMinimo: 100000 })], planesPara("visa"), HOY);
    expect(opcionesPara(100000, o)).toHaveLength(1);
    expect(opcionesPara(99999.99, o)).toHaveLength(0);
  });

  it("respeta el rango de monto del proveedor", () => {
    const planes = [plan({ cuotas: 6, montoMin: 1000, montoMax: 500000 })];
    const o = armarOferta([visa], [opcion({ cuotas: 6 })], planes, HOY);
    expect(opcionesPara(999, o)).toHaveLength(0);
    expect(opcionesPara(500001, o)).toHaveLength(0);
    expect(opcionesPara(1000, o)).toHaveLength(1);
  });

  it("mismo monto ⇒ mismo resultado (no depende del producto)", () => {
    const o = armarOferta(
      [visa, master],
      [opcion({ cuotas: 3, sinInteres: true }), opcion({ cuotas: 12, medioId: master.id })],
      [...planesPara("visa"), ...planesPara("master", { 12: 30 })],
      HOY,
    );
    expect(opcionesPara(50000, o)).toEqual(opcionesPara(50000, o));
  });

  it("base inválida → sin opciones", () => {
    const o = armarOferta([visa], [opcion({ cuotas: 3 })], planesPara("visa"), HOY);
    expect(opcionesPara(0, o)).toEqual([]);
    expect(opcionesPara(Number.NaN, o)).toEqual([]);
  });
});

function op(p: Partial<OpcionCuotas> & { cuotas: number; montoCuota: number }): OpcionCuotas {
  return {
    medio: "visa",
    medioNombre: "Visa",
    total: p.montoCuota * p.cuotas,
    precioContado: 0,
    cftPct: null,
    teaPct: null,
    sinInteres: false,
    ...p,
  };
}

describe("mejorOpcion", () => {
  it("prefiere la de más cuotas sin interés sobre cualquier con interés", () => {
    const mejor = mejorOpcion([
      op({ cuotas: 6, montoCuota: 20000, sinInteres: true }),
      op({ medio: "master", cuotas: 12, montoCuota: 11000 }),
      op({ cuotas: 3, montoCuota: 40000, sinInteres: true }),
    ]);
    expect(mejor).toMatchObject({ cuotas: 6, sinInteres: true });
  });

  it("sin sin interés: la de menor cuota", () => {
    const mejor = mejorOpcion([
      op({ cuotas: 3, montoCuota: 41000 }),
      op({ cuotas: 12, montoCuota: 13500 }),
    ]);
    expect(mejor).toMatchObject({ cuotas: 12, montoCuota: 13500 });
  });

  it("empate: menor CFT (null al final), luego el orden de entrada", () => {
    expect(
      mejorOpcion([
        op({ medio: "visa", cuotas: 12, montoCuota: 13500, cftPct: null }),
        op({ medio: "master", cuotas: 12, montoCuota: 13500, cftPct: 80 }),
        op({ medio: "amex", cuotas: 12, montoCuota: 13500, cftPct: 60 }),
      ])?.medio,
    ).toBe("amex");
    expect(
      mejorOpcion([
        op({ medio: "visa", cuotas: 6, montoCuota: 10000, sinInteres: true, cftPct: 0 }),
        op({ medio: "master", cuotas: 6, montoCuota: 10000, sinInteres: true, cftPct: 0 }),
      ])?.medio,
    ).toBe("visa");
  });

  it("nada disponible → null", () => {
    expect(mejorOpcion([])).toBeNull();
  });
});

describe("maxCuotas", () => {
  it("global y por medio", () => {
    expect(
      maxCuotas([
        op({ cuotas: 3, montoCuota: 1 }),
        op({ cuotas: 12, montoCuota: 1 }),
        op({ medio: "master", cuotas: 6, montoCuota: 1 }),
      ]),
    ).toEqual({ global: 12, porMedio: { visa: 12, master: 6 } });
  });

  it("sin opciones → 1 y vacío", () => {
    expect(maxCuotas([])).toEqual({ global: 1, porMedio: {} });
  });
});

describe("proximoEscalon", () => {
  const planes = planesPara("visa", { 12: 10 });

  it("te faltan $30.000 para 6 cuotas sin interés", () => {
    const o = armarOferta(
      [visa],
      [opcion({ cuotas: 3, sinInteres: true }), opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 })],
      planes,
      HOY,
    );
    expect(proximoEscalon(120000, o)).toEqual({
      cuotas: 6,
      sinInteres: true,
      montoMinimo: 150000,
      faltante: 30000,
    });
  });

  it("elige el escalón más cercano, no el de más cuotas", () => {
    const o = armarOferta(
      [visa],
      [
        opcion({ cuotas: 9, sinInteres: true, montoMinimo: 300000 }),
        opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 }),
      ],
      planes,
      HOY,
    );
    expect(proximoEscalon(120000, o)).toMatchObject({ cuotas: 6, faltante: 30000 });
  });

  it("ya superó todos los mínimos → null", () => {
    const o = armarOferta(
      [visa],
      [opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 })],
      planes,
      HOY,
    );
    expect(proximoEscalon(200000, o)).toBeNull();
  });

  it("marcada sin interés con tasa > 0 no es escalón sin interés; sí fallback con interés", () => {
    const o = armarOferta(
      [visa],
      [opcion({ cuotas: 12, sinInteres: true, montoMinimo: 300000 })],
      planes,
      HOY,
    );
    expect(proximoEscalon(120000, o)).toEqual({
      cuotas: 12,
      sinInteres: false,
      montoMinimo: 300000,
      faltante: 180000,
    });
  });

  it("el fallback con interés tiene que superar el máximo actual", () => {
    const o = armarOferta(
      [visa],
      [opcion({ cuotas: 12 }), opcion({ cuotas: 6, montoMinimo: 300000 })],
      planesPara("visa", { 12: 10, 6: 5 }),
      HOY,
    );
    expect(proximoEscalon(120000, o)).toBeNull();
  });

  it("empate de monto mínimo → más cuotas", () => {
    const o = armarOferta(
      [visa, master],
      [
        opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 }),
        opcion({ cuotas: 9, sinInteres: true, montoMinimo: 150000, medioId: master.id }),
      ],
      [...planes, ...planesPara("master")],
      HOY,
    );
    expect(proximoEscalon(120000, o)).toMatchObject({ cuotas: 9 });
  });

  it("faltante redondeado hacia arriba al centavo", () => {
    const o = armarOferta(
      [visa],
      [opcion({ cuotas: 6, sinInteres: true, montoMinimo: 100.001 })],
      planes,
      HOY,
    );
    expect(proximoEscalon(100, o)?.faltante).toBe(0.01);
    const o2 = armarOferta(
      [visa],
      [opcion({ cuotas: 6, sinInteres: true, montoMinimo: 100.3 })],
      planes,
      HOY,
    );
    // 100.3 - 100.1 = 0.20000000000000284: un ceil ingenuo daría 0.21.
    expect(proximoEscalon(100.1, o2)?.faltante).toBe(0.2);
  });

  it("descarta escalones inalcanzables por el máximo del proveedor", () => {
    const o = armarOferta(
      [visa],
      [opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 })],
      [plan({ cuotas: 6, montoMax: 100000 })],
      HOY,
    );
    expect(proximoEscalon(50000, o)).toBeNull();
  });
});

describe("planPedido", () => {
  const oferta = armarOferta(
    [visa, master],
    [
      opcion({ cuotas: 3, sinInteres: true }),
      opcion({ cuotas: 6, sinInteres: true, montoMinimo: 150000 }),
      opcion({ cuotas: 3, medioId: master.id, montoMinimo: 100000 }),
    ],
    [...planesPara("visa"), ...planesPara("master", { 3: 8 })],
    HOY,
  );

  it("oferta null → null (legacy)", () => {
    expect(planPedido(200000, null)).toBeNull();
  });

  it("total que no alcanza ninguna opción → cuotasMax 1", () => {
    const soloAltas = armarOferta(
      [visa],
      [opcion({ cuotas: 6, montoMinimo: 500000 })],
      planesPara("visa"),
      HOY,
    );
    expect(planPedido(1000, soloAltas)).toMatchObject({ cuotasMax: 1, maxPorMedio: {}, opciones: [] });
  });

  it("pedido de $200.000 congela 6 cuotas y el máximo por medio", () => {
    const p = planPedido(200000, { ...oferta, configVersion: "2026-09-16T10:00:00Z", planesFetchedAt: "2026-09-16T06:00:00Z" });
    expect(p).toMatchObject({
      version: "v1",
      hoy: HOY,
      configVersion: "2026-09-16T10:00:00Z",
      planesFetchedAt: "2026-09-16T06:00:00Z",
      totalBase: 200000,
      cuotasMax: 6,
      maxPorMedio: { visa: 6, master: 3 },
    });
    expect(p?.opciones.length).toBe(3);
  });

  it("se calcula sobre el total real: $145.000 no incluye 6 cuotas", () => {
    const p = planPedido(145000, oferta);
    expect(p?.cuotasMax).toBe(3);
    expect(p?.opciones.some((x) => x.cuotas === 6)).toBe(false);
  });
});
