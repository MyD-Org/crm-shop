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

type Escalones = OfertaCuotas["proveedores"][number]["escalones"];

function op(p: Partial<OpcionOfertada> & { cuotas: number }): OpcionOfertada {
  return {
    sinInteres: (p.tasaPct ?? 0) === 0,
    tasaPct: 0,
    cftPct: null,
    teaPct: null,
    montoMin: null,
    montoMax: null,
    ...p,
  };
}

const esc = (...pares: [number, number][]): Escalones =>
  pares.map(([cuotasMax, montoMinimo]) => ({ cuotasMax, montoMinimo }));

/** Oferta de Mercado Pago con los escalones y el snapshot dados. */
function oferta(escalones: Escalones, opciones: OpcionOfertada[], extra: OfertaCuotas["proveedores"] = []): OfertaCuotas {
  return {
    proveedores: [{ proveedor: "mercadopago", nombre: "Mercado Pago", orden: 0, escalones, opciones }, ...extra],
    planesFetchedAt: null,
    configVersion: null,
  };
}

describe("textos", () => {
  it("montos y porcentajes en formato argentino", () => {
    expect(fmtMonto(20000)).toBe("$20.000");
    expect(fmtMonto(10333.33)).toBe("$10.333,33");
    expect(fmtMonto(13500.5)).toBe("$13.500,50");
    expect(fmtPct(45.678)).toBe("45,68%");
    expect(fmtPct(0)).toBe("0,00%");
  });

  it("línea de la card: sin interés con su cantidad; con interés 'Hasta N'", () => {
    expect(TEXTOS_CUOTAS.linea(6, 20000, true)).toBe("6 cuotas sin interés de $20.000");
    expect(TEXTOS_CUOTAS.linea(12, 13500, false)).toBe("Hasta 12 cuotas de $13.500");
  });

  it("carrito: hasta N y te faltan para hasta N", () => {
    expect(TEXTOS_CUOTAS.hasta(6, true)).toBe("Hasta 6 cuotas sin interés");
    expect(TEXTOS_CUOTAS.hasta(12, false)).toBe("Hasta 12 cuotas");
    expect(TEXTOS_CUOTAS.teFaltan(30000, 6)).toBe("Te faltan $30.000 para hasta 6 cuotas");
    expect(TEXTOS_CUOTAS.teFaltan(30000.01, 12)).toBe("Te faltan $30.000,01 para hasta 12 cuotas");
  });

  it("título del bloque del modal por proveedor", () => {
    expect(TEXTOS_CUOTAS.tituloProveedor("Mercado Pago")).toBe("Tarjetas de crédito (Mercado Pago)");
  });
});

describe("mejorOpcionPara", () => {
  const o = oferta(esc([6, 0]), [op({ cuotas: 3 }), op({ cuotas: 6 }), op({ cuotas: 12, tasaPct: 30 })]);

  it("sin oferta o sin precio final → nada (flag off, sin datos, sin IVA)", () => {
    expect(mejorOpcionPara(120000, null)).toBeNull();
    expect(mejorOpcionPara(undefined, o)).toBeNull();
  });

  it("la mayor cantidad sin interés dentro del máximo", () => {
    expect(mejorOpcionPara(120000, o)).toMatchObject({ cuotas: 6, montoCuota: 20000, sinInteres: true });
  });

  it("sin ninguna sin interés: la mayor cantidad con su cuota", () => {
    const conInteres = oferta(esc([12, 0]), [op({ cuotas: 3, tasaPct: 10 }), op({ cuotas: 12, tasaPct: 20 })]);
    expect(mejorOpcionPara(120000, conInteres)).toMatchObject({ cuotas: 12, montoCuota: 12000, sinInteres: false });
  });

  it("unitario que no alcanza ningún escalón → nada", () => {
    expect(mejorOpcionPara(100000, oferta(esc([6, 150000]), [op({ cuotas: 6 })]))).toBeNull();
  });
});

describe("resumenCuotas (carrito / checkout)", () => {
  const o = oferta(esc([3, 0], [6, 150000]), [op({ cuotas: 3 }), op({ cuotas: 6 }), op({ cuotas: 12, tasaPct: 30 })]);

  it("escalón: te faltan $30.000 para hasta 6 cuotas y barra al 80%", () => {
    const r = resumenCuotas(120000, o)!;
    expect(r.titulo).toBe("Hasta 3 cuotas sin interés");
    expect(r.escalon).toEqual({
      texto: "Te faltan $30.000 para hasta 6 cuotas",
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

  it("'sin interés' sólo si la opción de N cuotas tiene tasa 0", () => {
    const mixta = oferta(esc([12, 0]), [op({ cuotas: 6 }), op({ cuotas: 12, tasaPct: 30 })]);
    const r = resumenCuotas(120000, mixta)!;
    expect(r.titulo).toBe("Hasta 12 cuotas");
    // La línea secundaria sigue destacando la mejor sin interés.
    expect(r.mejor).toMatchObject({ cuotas: 6, sinInteres: true });
  });

  it("carrito vacío, total 0 o sin oferta → nada", () => {
    expect(resumenCuotas(0, o)).toBeNull();
    expect(resumenCuotas(null, o)).toBeNull();
    expect(resumenCuotas(120000, null)).toBeNull();
  });

  it("sin opciones pero con escalón: sólo el escalón", () => {
    const soloAlto = oferta(esc([6, 150000]), [op({ cuotas: 6 })]);
    const r = resumenCuotas(50000, soloAlto)!;
    expect(r.titulo).toBeNull();
    expect(r.escalon?.texto).toBe("Te faltan $100.000 para hasta 6 cuotas");
    expect(r.escalon?.progresoPct).toBe(33);
  });

  it("sin opciones ni escalón → nada", () => {
    expect(resumenCuotas(50000, oferta(esc([3, 0]), []))).toBeNull();
  });

  it("checkout: el máximo congelado del pedido recorta lo que se muestra", () => {
    const amplia = oferta(esc([12, 0]), [op({ cuotas: 3 }), op({ cuotas: 12 })]);
    const r = resumenCuotas(200000, amplia, { cuotasMax: 3 })!;
    expect(r.titulo).toBe("Hasta 3 cuotas sin interés");
    expect(r.mejor?.cuotas).toBe(3);
    // En el checkout el pedido ya está armado: no se invita a sumar productos.
    expect(r.escalon).toBeNull();
  });

  it("checkout con pedido de 1 cuota → nada", () => {
    expect(resumenCuotas(200000, oferta(esc([6, 0]), [op({ cuotas: 6 })]), { cuotasMax: 1 })).toBeNull();
  });
});

describe("bloquesMediosDePago (modal de la ficha)", () => {
  it("un bloque por proveedor, titulado por tarjetas de crédito, con todas las cantidades hasta el máximo", () => {
    const o = oferta(esc([12, 0]), [
      op({ cuotas: 3 }),
      op({ cuotas: 6 }),
      op({ cuotas: 12, tasaPct: 40, cftPct: 55.5, teaPct: 42.1 }),
      op({ cuotas: 18, tasaPct: 60 }),
    ]);
    const bloques = bloquesMediosDePago(120000, o);
    expect(bloques).toHaveLength(1);
    expect(bloques[0]).toMatchObject({ proveedor: "mercadopago", titulo: "Tarjetas de crédito (Mercado Pago)", precioContado: 120000 });
    expect(bloques[0].opciones.map((x) => x.cuotas)).toEqual([3, 6, 12]);
    expect(bloques[0].opciones[2]).toMatchObject({ total: 168000, cftPct: 55.5 });
  });

  it("proveedor sin opciones para ese precio → queda con sólo 1 pago", () => {
    const o = oferta(esc([6, 500000]), [op({ cuotas: 6 })]);
    expect(bloquesMediosDePago(120000, o)[0]).toMatchObject({ opciones: [] });
  });

  it("sin oferta o sin precio → []", () => {
    expect(bloquesMediosDePago(120000, null)).toEqual([]);
    expect(bloquesMediosDePago(undefined, oferta(esc([3, 0]), [op({ cuotas: 3 })]))).toEqual([]);
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
