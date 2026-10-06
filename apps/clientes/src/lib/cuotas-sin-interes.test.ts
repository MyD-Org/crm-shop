import { describe, expect, it } from "vitest";
import {
  condicionesAplicables,
  proximoEscalon,
  cuotasElegidas,
  idListaDeCuotas,
  mejorOpcionCuotas,
  opcionesCuotas,
  montoPorCuota,
  mejorCuotaProducto,
  opcionesCombinadas,
  type MedioCuotas,
} from "./cuotas-sin-interes";
import type { AlegraPrice } from "./alegra";

describe("montoPorCuota (total / N redondeado al centavo hacia arriba)", () => {
  it("división exacta: 1.200,00 en 6 son 200,00", () => {
    expect(montoPorCuota(1200, 6)).toBe(200);
  });

  it("redondea hacia arriba: 100,00 en 3 = 33,34 (no 33,33)", () => {
    expect(montoPorCuota(100, 3)).toBe(33.34);
    expect(montoPorCuota(121, 3)).toBe(40.34);
    expect(montoPorCuota(0.1, 3)).toBe(0.04);
  });

  it("nunca queda por debajo del total / N ni lo pasa por un centavo o más", () => {
    for (const total of [0.01, 19.99, 99999.99, 123456.78, 1.1, 2.2]) {
      for (const n of [2, 3, 6, 9, 12, 18, 24]) {
        const m = montoPorCuota(total, n);
        const exacto = Math.round(total * 100) / n;
        expect(m * 100).toBeGreaterThanOrEqual(exacto - 1e-9);
        expect(m * 100 - exacto).toBeLessThan(1);
      }
    }
  });

  it("cuotas null o 1 = el total; inválidos no tiran", () => {
    expect(montoPorCuota(100, 1)).toBe(100);
    expect(montoPorCuota(100, null)).toBe(100);
    expect(montoPorCuota(100, 0)).toBe(100);
    expect(montoPorCuota(100, 2.5)).toBe(100);
    expect(montoPorCuota(Number.NaN, 3)).toBe(0);
  });
});

const prices = (lista: Record<string, number>, principal: string): AlegraPrice[] =>
  Object.entries(lista).map(([id, price]) => ({ idPriceList: id, name: `Lista ${id}`, price, main: id === principal }));

const medio: MedioCuotas = {
  slug: "mercadopago",
  nombre: "Mercado Pago",
  condiciones: [
    { cuotas: 6, idListaPrecios: "L6" },
    { cuotas: 3, idListaPrecios: "L3" },
  ],
};

describe("opcionesCuotas (por producto)", () => {
  // Referencia 1.000 neto; 3 cuotas a 900; 6 cuotas a 960. IVA 21 %.
  const precios = prices({ REF: 1000, L3: 900, L6: 960 }, "REF");

  it("arma una opción por condición, ascendente, con el total de SU lista con IVA", () => {
    const o = opcionesCuotas(precios, 21, medio);
    expect(o.map((x) => x.cuotas)).toEqual([3, 6]);
    expect(o[0]).toMatchObject({ cuotas: 3, total: 1089, montoCuota: 363, sinInteres: true });
    expect(o[1]).toMatchObject({ cuotas: 6, total: 1161.6, montoCuota: 193.6 });
  });

  it("si no divide exacto, montoCuota se redondea hacia arriba", () => {
    const o = opcionesCuotas(prices({ REF: 200, L3: 100 }, "REF"), 21, {
      slug: "mercadopago",
      nombre: "Mercado Pago",
      condiciones: [{ cuotas: 3, idListaPrecios: "L3" }],
    });
    // 100,00 + 21 % = 121,00 → 40,33333… → 40,34
    expect(o[0]).toMatchObject({ total: 121, montoCuota: 40.34 });
  });

  it("una lista que no es MENOR que la general cae a la general (misma regla que la cotización)", () => {
    const o = opcionesCuotas(prices({ REF: 1000, L3: 1200 }, "REF"), 21, {
      slug: "mercadopago",
      nombre: "Mercado Pago",
      condiciones: [{ cuotas: 3, idListaPrecios: "L3" }],
    });
    expect(o[0].total).toBe(1210);
  });

  it("sin IVA conocido, sin medio o sin condiciones: sin opciones (nunca un monto inventado)", () => {
    expect(opcionesCuotas(precios, null, medio)).toEqual([]);
    expect(opcionesCuotas(precios, undefined, medio)).toEqual([]);
    expect(opcionesCuotas(precios, 21, null)).toEqual([]);
    expect(opcionesCuotas(precios, 21, { ...medio, condiciones: [] })).toEqual([]);
    expect(opcionesCuotas([], 21, medio)).toEqual([]);
  });

  it("ignora condiciones inválidas (cuotas < 2, > 24, repetidas o sin lista)", () => {
    const o = opcionesCuotas(precios, 21, {
      ...medio,
      condiciones: [
        { cuotas: 1, idListaPrecios: "L3" },
        { cuotas: 25, idListaPrecios: "L3" },
        { cuotas: 3, idListaPrecios: "" },
        { cuotas: 3, idListaPrecios: "L3" },
        { cuotas: 3, idListaPrecios: "L6" },
      ],
    });
    expect(o.map((x) => [x.cuotas, x.total])).toEqual([[3, 1089]]);
  });

  it("nunca hay 'con interés': no existe recargo ni total_con_recargo", () => {
    const o = opcionesCuotas(precios, 21, medio);
    for (const x of o) {
      expect(x.sinInteres).toBe(true);
      expect(x).not.toHaveProperty("recargo");
      expect(x).not.toHaveProperty("totalConRecargo");
    }
  });
});

describe("mejorOpcionCuotas", () => {
  it("la de mayor cantidad de cuotas", () => {
    const o = opcionesCuotas(prices({ REF: 1000, L3: 900, L6: 960 }, "REF"), 21, medio);
    expect(mejorOpcionCuotas(o)?.cuotas).toBe(6);
  });
  it("sin opciones, null", () => {
    expect(mejorOpcionCuotas([])).toBeNull();
    expect(mejorOpcionCuotas(undefined)).toBeNull();
  });
});

describe("mejor opción y opciones combinadas entre medios", () => {
  const op = (cuotas: number, total: number) => ({ cuotas, total, montoCuota: montoPorCuota(total, cuotas), sinInteres: true as const });
  const cuotas = {
    medios: [
      { slug: "mp", medio: "MP", opciones: [op(3, 900), op(6, 960)] },
      { slug: "pw", medio: "PW", opciones: [op(3, 880), op(12, 1200)] },
    ],
  };

  it("mejor: la de más cuotas entre todos los medios", () => {
    expect(mejorCuotaProducto(cuotas)?.cuotas).toBe(12);
  });

  it("empate de cantidad: la de menor cuota", () => {
    const e = { medios: [{ slug: "a", medio: "A", opciones: [op(6, 1200)] }, { slug: "b", medio: "B", opciones: [op(6, 1140)] }] };
    expect(mejorCuotaProducto(e)?.montoCuota).toBe(190);
  });

  it("sin medios, null", () => {
    expect(mejorCuotaProducto(undefined)).toBeNull();
    expect(mejorCuotaProducto({ medios: [] })).toBeNull();
  });

  it("combinadas: una fila por cantidad, ascendentes; repetida = la de menor total", () => {
    expect(opcionesCombinadas(cuotas).map((o) => [o.cuotas, o.total])).toEqual([
      [3, 880],
      [6, 960],
      [12, 1200],
    ]);
    expect(opcionesCombinadas(undefined)).toEqual([]);
  });
});

describe("cuotasElegidas / idListaDeCuotas (lo que el servidor acepta)", () => {
  it("sin cuotas (o 1) es un pago", () => {
    expect(cuotasElegidas(undefined, medio.condiciones)).toEqual({ ok: true, cuotas: 1 });
    expect(cuotasElegidas(null, medio.condiciones)).toEqual({ ok: true, cuotas: 1 });
    expect(cuotasElegidas(1, medio.condiciones)).toEqual({ ok: true, cuotas: 1 });
  });

  it("una cantidad con condición se acepta", () => {
    expect(cuotasElegidas(6, medio.condiciones)).toEqual({ ok: true, cuotas: 6 });
  });

  it("una cantidad SIN condición se rechaza", () => {
    expect(cuotasElegidas(12, medio.condiciones)).toEqual({ ok: false });
    expect(cuotasElegidas(2, medio.condiciones)).toEqual({ ok: false });
  });

  it("rechaza lo que no es un entero >= 1 (string, decimal, 0, negativo, NaN)", () => {
    for (const malo of ["6", 3.5, 0, -1, Number.NaN, {}, []]) {
      expect(cuotasElegidas(malo, medio.condiciones)).toEqual({ ok: false });
    }
  });

  it("idListaDeCuotas devuelve la lista de la condición y undefined para un pago", () => {
    expect(idListaDeCuotas(medio.condiciones, 6)).toBe("L6");
    expect(idListaDeCuotas(medio.condiciones, 3)).toBe("L3");
    expect(idListaDeCuotas(medio.condiciones, 1)).toBeUndefined();
    expect(idListaDeCuotas(medio.condiciones, 9)).toBeUndefined();
  });
});

describe("condicionesAplicables (monto mínimo por cantidad de cuotas)", () => {
  const cond = (cuotas: number, montoMinimo?: number | null) => ({ cuotas, idListaPrecios: `L${cuotas}`, montoMinimo });

  it("sin mínimo (null o ausente) siempre aplica: el comportamiento de hoy", () => {
    const c = [cond(3, null), cond(6), cond(12, null)];
    expect(condicionesAplicables(c, 0.01).map((x) => x.cuotas)).toEqual([3, 6, 12]);
  });

  it("bajo el mínimo por un centavo no aplica", () => {
    expect(condicionesAplicables([cond(6, 60000)], 59999.99)).toEqual([]);
  });

  it("justo en el mínimo aplica (la igualdad cuenta)", () => {
    expect(condicionesAplicables([cond(6, 60000)], 60000).map((x) => x.cuotas)).toEqual([6]);
  });

  it("sobre el mínimo aplica", () => {
    expect(condicionesAplicables([cond(6, 60000)], 60000.01).map((x) => x.cuotas)).toEqual([6]);
  });

  it("compara en centavos: el ruido de coma flotante no deja afuera al que llega justo", () => {
    // 0.1 + 0.2 = 0.30000000000000004 en flotante; el mínimo 0,30 se alcanza.
    expect(condicionesAplicables([cond(3, 0.3)], 0.1 + 0.2).map((x) => x.cuotas)).toEqual([3]);
    // 1,005 (en flotante 1.00499999...) redondea a 100 centavos: 1,01 no se alcanza.
    expect(condicionesAplicables([cond(3, 1.01)], 1.005)).toEqual([]);
  });

  it("mínimo 0 siempre aplica", () => {
    expect(condicionesAplicables([cond(3, 0)], 0).map((x) => x.cuotas)).toEqual([3]);
  });

  it("deja cada escalón con su propio mínimo, ascendente", () => {
    const c = [cond(12, 120000), cond(3), cond(6, 60000)];
    expect(condicionesAplicables(c, 70000).map((x) => x.cuotas)).toEqual([3, 6]);
    expect(condicionesAplicables(c, 120000).map((x) => x.cuotas)).toEqual([3, 6, 12]);
    expect(condicionesAplicables(c, 10000).map((x) => x.cuotas)).toEqual([3]);
  });

  it("sin condiciones o con una base inválida (NaN, negativa) no ofrece las que tienen mínimo", () => {
    expect(condicionesAplicables(null, 1000)).toEqual([]);
    expect(condicionesAplicables([cond(3), cond(6, 100)], Number.NaN).map((x) => x.cuotas)).toEqual([3]);
  });
});

describe("cuotasElegidas con base (validación del mínimo en el servidor)", () => {
  const condiciones = [
    { cuotas: 3, idListaPrecios: "L3" },
    { cuotas: 6, idListaPrecios: "L6", montoMinimo: 60000 },
  ];

  it("rechaza una cantidad cuyo mínimo no alcanza la base", () => {
    expect(cuotasElegidas(6, condiciones, 30000)).toEqual({ ok: false });
    expect(cuotasElegidas(6, condiciones, 59999.99)).toEqual({ ok: false });
  });

  it("acepta la que sí lo alcanza y las que no tienen mínimo", () => {
    expect(cuotasElegidas(6, condiciones, 60000)).toEqual({ ok: true, cuotas: 6 });
    expect(cuotasElegidas(3, condiciones, 30000)).toEqual({ ok: true, cuotas: 3 });
  });

  it("un pago siempre se acepta, aunque la base sea baja", () => {
    expect(cuotasElegidas(1, condiciones, 10)).toEqual({ ok: true, cuotas: 1 });
    expect(cuotasElegidas(undefined, condiciones, 10)).toEqual({ ok: true, cuotas: 1 });
  });
});

describe("opcionesCuotas con mínimo (informativo, precio unitario)", () => {
  // Pago único L1 a 1.000 neto (1.210 con IVA 21 %); 6 cuotas a 1.100 neto desde 2.000.
  const precios = prices({ REF: 1200, L1: 1000, L6: 1100 }, "REF");
  const medioMin: MedioCuotas = {
    slug: "mercadopago",
    nombre: "Mercado Pago",
    idListaPagoUnico: "L1",
    condiciones: [
      { cuotas: 3, idListaPrecios: "L6" },
      { cuotas: 6, idListaPrecios: "L6", montoMinimo: 2000 },
    ],
  };

  it("compara contra el precio unitario con impuestos a la lista del pago único", () => {
    expect(opcionesCuotas(precios, 21, medioMin).map((o) => o.cuotas)).toEqual([3]);
    expect(opcionesCuotas(precios, 21, { ...medioMin, condiciones: [{ cuotas: 6, idListaPrecios: "L6", montoMinimo: 1210 }] }).map((o) => o.cuotas)).toEqual([6]);
  });

  it("sin lista de pago único usa la de referencia", () => {
    const sin = { ...medioMin, idListaPagoUnico: null, condiciones: [{ cuotas: 6, idListaPrecios: "L6", montoMinimo: 1452 }] };
    // REF 1200 * 1,21 = 1452
    expect(opcionesCuotas(precios, 21, sin).map((o) => o.cuotas)).toEqual([6]);
    expect(opcionesCuotas(precios, 21, { ...sin, condiciones: [{ cuotas: 6, idListaPrecios: "L6", montoMinimo: 1452.01 }] })).toEqual([]);
  });
});

describe("proximoEscalon (cuánto falta para la próxima cantidad de cuotas)", () => {
  const cond = (cuotas: number, montoMinimo?: number | null) => ({ cuotas, idListaPrecios: `L${cuotas}`, montoMinimo });

  it("la condición no alcanzada con el menor mínimo, y cuánto falta (2 decimales)", () => {
    const c = [cond(3), cond(6, 60000), cond(12, 120000)];
    expect(proximoEscalon(c, 45000.5)).toEqual({ cuotas: 6, falta: 14999.5 });
    expect(proximoEscalon(c, 60000)).toEqual({ cuotas: 12, falta: 60000 });
  });

  it("null si ya alcanza todas o no hay mínimos", () => {
    expect(proximoEscalon([cond(3), cond(6, 60000)], 60000)).toBeNull();
    expect(proximoEscalon([cond(3), cond(6)], 10)).toBeNull();
    expect(proximoEscalon(null, 10)).toBeNull();
  });

  it("sin ruido de coma flotante", () => {
    expect(proximoEscalon([cond(6, 0.3)], 0.1 + 0.1)).toEqual({ cuotas: 6, falta: 0.1 });
  });
});
