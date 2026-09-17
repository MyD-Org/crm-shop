import { describe, expect, it } from "vitest";
import {
  baseCarrito,
  bloquesMediosDePago,
  mejorOpcionPara,
  resumenCuotas,
} from "./cuotas-exhibicion";
import { fmtMonto, fmtPct, TEXTOS_CUOTAS } from "./cuotas-textos";
import type { OfertaCuotas, OpcionOfertada } from "./pagos/cuotas-tipos";

/**
 * Helpers de exhibición: lo que ven card, ficha, carrito y checkout. El cálculo
 * lo hace el motor (cuotas.ts); acá se decide QUÉ mostrar y con qué texto.
 */

function op(p: Partial<OpcionOfertada> & { cuotas: number }): OpcionOfertada {
  return {
    sinInteres: false,
    montoMinimo: 0,
    tasaPct: 0,
    cftPct: null,
    teaPct: null,
    montoMin: null,
    montoMax: null,
    ...p,
  };
}

function oferta(
  visa: OpcionOfertada[],
  master: OpcionOfertada[] = [],
): OfertaCuotas {
  const medios: OfertaCuotas["medios"] = [{ codigo: "visa", nombre: "Visa", orden: 0, opciones: visa }];
  if (master.length > 0) medios.push({ codigo: "master", nombre: "Mastercard", orden: 1, opciones: master });
  return { medios, hoy: "2026-09-16", planesFetchedAt: null, configVersion: null };
}

describe("textos", () => {
  it("montos y porcentajes en formato argentino", () => {
    expect(fmtMonto(20000)).toBe("$20.000");
    expect(fmtMonto(10333.33)).toBe("$10.333,33");
    expect(fmtMonto(13500.5)).toBe("$13.500,50");
    expect(fmtPct(45.678)).toBe("45,68%");
    expect(fmtPct(0)).toBe("0,00%");
  });

  it("línea de la card: sin interés lo dice, con interés no", () => {
    expect(TEXTOS_CUOTAS.linea(6, 20000, true)).toBe("6 cuotas sin interés de $20.000");
    expect(TEXTOS_CUOTAS.linea(12, 13500, false)).toBe("12 cuotas de $13.500");
  });

  it("carrito: hasta N y te faltan", () => {
    expect(TEXTOS_CUOTAS.hasta(6, true)).toBe("Hasta 6 cuotas sin interés");
    expect(TEXTOS_CUOTAS.hasta(12, false)).toBe("Hasta 12 cuotas");
    expect(TEXTOS_CUOTAS.teFaltan(30000, 6, true)).toBe("Te faltan $30.000 para 6 cuotas sin interés");
    expect(TEXTOS_CUOTAS.teFaltan(30000.01, 12, false)).toBe("Te faltan $30.000,01 para 12 cuotas");
  });
});

describe("mejorOpcionPara", () => {
  const o = oferta([op({ cuotas: 6, sinInteres: true })]);

  it("sin oferta o sin precio final → nada (flag off, sin datos, sin IVA)", () => {
    expect(mejorOpcionPara(120000, null)).toBeNull();
    expect(mejorOpcionPara(undefined, o)).toBeNull();
  });

  it("con oferta: la mejor opción sobre el monto", () => {
    expect(mejorOpcionPara(120000, o)).toMatchObject({ cuotas: 6, montoCuota: 20000, sinInteres: true });
  });

  it("unitario que no alcanza el mínimo → nada", () => {
    const conMinimo = oferta([op({ cuotas: 6, sinInteres: true, montoMinimo: 150000 })]);
    expect(mejorOpcionPara(100000, conMinimo)).toBeNull();
  });
});

describe("resumenCuotas (carrito / checkout)", () => {
  const o = oferta([
    op({ cuotas: 3, sinInteres: true }),
    op({ cuotas: 6, sinInteres: true, montoMinimo: 150000 }),
  ]);

  it("escalón: te faltan $30.000 para 6 sin interés y barra al 80%", () => {
    const r = resumenCuotas(120000, o)!;
    expect(r.titulo).toBe("Hasta 3 cuotas sin interés");
    expect(r.escalon).toEqual({
      texto: "Te faltan $30.000 para 6 cuotas sin interés",
      progresoPct: 80,
      faltante: 30000,
      montoMinimo: 150000,
    });
  });

  it("al subir el total pasa el escalón y el mensaje desaparece", () => {
    const r = resumenCuotas(160000, o)!;
    expect(r.titulo).toBe("Hasta 6 cuotas sin interés");
    expect(r.escalon).toBeNull();
  });

  it("carrito vacío, total 0 o sin oferta → nada", () => {
    expect(resumenCuotas(0, o)).toBeNull();
    expect(resumenCuotas(null, o)).toBeNull();
    expect(resumenCuotas(120000, null)).toBeNull();
  });

  it("sin opciones pero con escalón: sólo el escalón", () => {
    const soloAlto = oferta([op({ cuotas: 6, sinInteres: true, montoMinimo: 150000 })]);
    const r = resumenCuotas(50000, soloAlto)!;
    expect(r.titulo).toBeNull();
    expect(r.escalon?.texto).toBe("Te faltan $100.000 para 6 cuotas sin interés");
    expect(r.escalon?.progresoPct).toBe(33);
  });

  it("sin opciones ni escalón → nada", () => {
    expect(resumenCuotas(50000, oferta([]))).toBeNull();
  });

  it("mejor opción con interés: 'Hasta N cuotas' con el máximo, sin 'sin interés'", () => {
    const conInteres = oferta([op({ cuotas: 3, tasaPct: 10 }), op({ cuotas: 12, tasaPct: 40 })]);
    const r = resumenCuotas(120000, conInteres)!;
    expect(r.titulo).toBe("Hasta 12 cuotas");
    expect(r.mejor).toMatchObject({ cuotas: 12, sinInteres: false });
  });

  it("escalón con interés: 'para N cuotas'", () => {
    const conInteres = oferta([op({ cuotas: 3, tasaPct: 10 }), op({ cuotas: 12, tasaPct: 40, montoMinimo: 200000 })]);
    expect(resumenCuotas(120000, conInteres)!.escalon?.texto).toBe("Te faltan $80.000 para 12 cuotas");
  });

  it("checkout: el máximo congelado del pedido recorta lo que se muestra", () => {
    const amplia = oferta([op({ cuotas: 3, sinInteres: true }), op({ cuotas: 12, sinInteres: true })]);
    const r = resumenCuotas(200000, amplia, { cuotasMax: 3 })!;
    expect(r.titulo).toBe("Hasta 3 cuotas sin interés");
    expect(r.mejor?.cuotas).toBe(3);
    // En el checkout el pedido ya está armado: no se invita a sumar productos.
    expect(r.escalon).toBeNull();
  });

  it("checkout con pedido de 1 cuota → nada", () => {
    expect(resumenCuotas(200000, oferta([op({ cuotas: 6, sinInteres: true })]), { cuotasMax: 1 })).toBeNull();
  });
});

describe("bloquesMediosDePago (modal de la ficha)", () => {
  it("un bloque por medio con 1 pago, opciones y CFT/TEA sólo con interés", () => {
    const o = oferta(
      [op({ cuotas: 6, sinInteres: true }), op({ cuotas: 12, tasaPct: 40, cftPct: 55.5, teaPct: 42.1 })],
      [op({ cuotas: 3, tasaPct: 10, cftPct: 20, teaPct: 15 })],
    );
    const bloques = bloquesMediosDePago(120000, o);
    expect(bloques.map((b) => b.nombre)).toEqual(["Visa", "Mastercard"]);
    expect(bloques[0].precioContado).toBe(120000);
    expect(bloques[0].opciones).toHaveLength(2);
    expect(bloques[0].opciones[0]).toMatchObject({ cuotas: 6, total: 120000, sinInteres: true });
    expect(bloques[0].opciones[1]).toMatchObject({ cuotas: 12, total: 168000, cftPct: 55.5 });
  });

  it("medio sin opciones para ese precio → queda con sólo 1 pago", () => {
    const o = oferta([op({ cuotas: 6, montoMinimo: 500000 })], [op({ cuotas: 3, tasaPct: 10 })]);
    const bloques = bloquesMediosDePago(120000, o);
    expect(bloques[0]).toMatchObject({ nombre: "Visa", opciones: [] });
    expect(bloques[1].opciones).toHaveLength(1);
  });

  it("sin oferta o sin precio → []", () => {
    expect(bloquesMediosDePago(120000, null)).toEqual([]);
    expect(bloquesMediosDePago(undefined, oferta([op({ cuotas: 3 })]))).toEqual([]);
  });
});

describe("baseCarrito", () => {
  const lineas = [
    { id: "a", qty: 1, precioUnitario: 100000, ivaPorcentaje: 21 },
    { id: "b", qty: 2, precioUnitario: 10000, ivaPorcentaje: 10.5 },
  ];

  it("cotización vigente: su total manda", () => {
    expect(baseCarrito({ items: [], totalConfirmado: 145000, ultimasLineas: lineas })).toBe(145000);
  });

  it("recotizando: estima con precio e IVA ya conocidos y las cantidades nuevas", () => {
    const items = [
      { id: "a", qty: 2 },
      { id: "b", qty: 2 },
    ];
    // 2 × 121.000 + 2 × 11.050
    expect(baseCarrito({ items, totalConfirmado: null, ultimasLineas: lineas })).toBe(264100);
  });

  it("recotizando con un producto nuevo (sin IVA conocido) → sin base", () => {
    const items = [
      { id: "a", qty: 1 },
      { id: "z", qty: 1 },
    ];
    expect(baseCarrito({ items, totalConfirmado: null, ultimasLineas: lineas })).toBeNull();
  });

  it("línea con problema no se estima", () => {
    const conProblema = [{ ...lineas[0], problema: "sin_stock" }];
    expect(baseCarrito({ items: [{ id: "a", qty: 1 }], totalConfirmado: null, ultimasLineas: conProblema })).toBeNull();
  });

  it("sin cotización previa o carrito vacío → sin base", () => {
    expect(baseCarrito({ items: [{ id: "a", qty: 1 }], totalConfirmado: null, ultimasLineas: null })).toBeNull();
    expect(baseCarrito({ items: [], totalConfirmado: null, ultimasLineas: lineas })).toBeNull();
  });
});
