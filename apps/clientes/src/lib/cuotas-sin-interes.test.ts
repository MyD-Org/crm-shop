import { describe, expect, it } from "vitest";
import {
  condicionesAplicables,
  cuotasElegidas,
  idListaDeCuotas,
  mejorOpcionCuotas,
  opcionesCuotas,
  repartirCuotas,
  type MedioCuotas,
} from "./cuotas-sin-interes";
import type { AlegraPrice } from "./alegra";

const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe("repartirCuotas (cuota = total de la lista / N, sin recargo)", () => {
  it("división exacta: 1.200,00 en 6 son seis cuotas de 200,00", () => {
    expect(repartirCuotas(1200, 6)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("el resto de centavos va a la primera cuota: 100,00 en 3 = 33,34 + 33,33 + 33,33", () => {
    expect(repartirCuotas(100, 3)).toEqual([33.34, 33.33, 33.33]);
  });

  it("resto de más de un centavo: todo a la primera", () => {
    expect(repartirCuotas(100.02, 4)).toEqual([25.02, 25, 25, 25]);
    expect(repartirCuotas(0.1, 3)).toEqual([0.04, 0.03, 0.03]);
  });

  it("la suma de las cuotas siempre iguala el total (sin ruido de coma flotante)", () => {
    for (const total of [0.01, 19.99, 99999.99, 123456.78, 1.1, 2.2]) {
      for (const n of [2, 3, 6, 9, 12, 18, 24]) {
        const cuotas = repartirCuotas(total, n);
        expect(cuotas).toHaveLength(n);
        expect(suma(cuotas)).toBe(Math.round(total * 100) / 100);
        // La primera nunca es menor que las demás y difieren a lo sumo en n-1 centavos.
        expect(cuotas[0]).toBeGreaterThanOrEqual(cuotas[1]);
        expect(Math.round((cuotas[0] - cuotas[1]) * 100)).toBeLessThan(n);
      }
    }
  });

  it("cuotas null o 1 = un pago", () => {
    expect(repartirCuotas(100, 1)).toEqual([100]);
    expect(repartirCuotas(100, null)).toEqual([100]);
  });

  it("valores inválidos no tiran: un pago", () => {
    expect(repartirCuotas(100, 0)).toEqual([100]);
    expect(repartirCuotas(100, -3)).toEqual([100]);
    expect(repartirCuotas(100, 2.5)).toEqual([100]);
    expect(repartirCuotas(Number.NaN, 3)).toEqual([0]);
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
    expect(o[0]).toMatchObject({ cuotas: 3, total: 1089, montoCuota: 363, primeraCuota: 363, sinInteres: true });
    expect(o[1]).toMatchObject({ cuotas: 6, total: 1161.6, montoCuota: 193.6, primeraCuota: 193.6 });
  });

  it("si no divide exacto, montoCuota es la cuota común y primeraCuota la que absorbe el resto", () => {
    const o = opcionesCuotas(prices({ REF: 200, L3: 100 }, "REF"), 21, {
      slug: "mercadopago",
      nombre: "Mercado Pago",
      condiciones: [{ cuotas: 3, idListaPrecios: "L3" }],
    });
    // 100,00 + 21 % = 121,00 → 40,34 + 40,33 + 40,33
    expect(o[0]).toMatchObject({ total: 121, montoCuota: 40.33, primeraCuota: 40.34 });
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
