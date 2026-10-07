import { describe, expect, it } from "vitest";
import { cuotasHastaFicha, lineasConProducto, metaCuotasFicha } from "./ficha-cuotas-carrito";
import { TEXTOS_CUOTAS } from "./cuotas-textos";

const sinNbsp = (s: string | undefined) => s?.replace(/[  ]/g, " ");

describe("lineasConProducto", () => {
  it("carrito vacío: null (no hay nada que cotizar)", () => {
    expect(lineasConProducto([], "10", 1)).toBeNull();
  });
  it("suma el producto como una línea más, sin tocar las del carrito", () => {
    const carrito = [{ id: "1", qty: 2 }];
    expect(lineasConProducto(carrito, "10", 3)).toEqual([
      { id: "1", qty: 2 },
      { id: "10", qty: 3 },
    ]);
    expect(carrito).toEqual([{ id: "1", qty: 2 }]);
  });
  it("si el producto ya está en el carrito, suma la cantidad", () => {
    expect(lineasConProducto([{ id: "10", qty: 2 }, { id: "1", qty: 1 }], "10", 1)).toEqual([
      { id: "10", qty: 3 },
      { id: "1", qty: 1 },
    ]);
  });
  it("cantidad inválida cuenta como 1", () => {
    expect(lineasConProducto([{ id: "1", qty: 1 }], "10", 0)).toEqual([{ id: "1", qty: 1 }, { id: "10", qty: 1 }]);
    expect(lineasConProducto([{ id: "1", qty: 1 }], "10", Number.NaN)).toEqual([{ id: "1", qty: 1 }, { id: "10", qty: 1 }]);
  });
});

describe("metaCuotasFicha", () => {
  it("llega al nivel más alto: una línea sin monto, barra llena y énfasis en las cuotas", () => {
    for (const montoCuota of [undefined, 10000]) {
      const m = metaCuotasFicha({ cuotasActuales: 12, proximo: null, pct: 100, montoCuota });
      expect(m).toMatchObject({ id: "cuotas", alcanzada: true, pct: 100 });
      expect(m?.texto).toBe("Con su carrito, su compra ya tiene 12 cuotas sin interés.");
      expect(m?.enfasis).toBe("12 cuotas sin interés");
      expect(m?.textoAlcanzado).toBeUndefined();
    }
  });
  it("llega a un nivel y hay otro más alto: lo que ya tiene (sin el monto de la compra) y cuánto falta", () => {
    const m = metaCuotasFicha({ cuotasActuales: 8, proximo: { cuotas: 12, falta: 15000, minimo: 60000 }, pct: 75, montoCuota: 4299.16 });
    expect(m).toMatchObject({ alcanzada: false, pct: 75 });
    expect(m?.textoAlcanzado).toBe("Con su carrito, ya tiene 8 cuotas sin interés.");
    expect(m?.enfasisAlcanzado).toBe("8 cuotas sin interés");
    expect(sinNbsp(m?.texto)).toBe("Sume $ 15.000 más y pague en 12 cuotas sin interés.");
    expect(sinNbsp(m?.enfasis)).toBe("$ 15.000");
    expect(JSON.stringify(m)).not.toContain("4.299");
  });
  it("no llega: cuánto falta, con la barra", () => {
    const m = metaCuotasFicha({ cuotasActuales: null, proximo: { cuotas: 6, falta: 15000, minimo: 60000 }, pct: 75 });
    expect(m).toMatchObject({ id: "cuotas", alcanzada: false, pct: 75 });
    expect(sinNbsp(m?.texto)).toBe("Con su carrito y este producto, sume $ 15.000 más y pague en 6 cuotas sin interés.");
    expect(sinNbsp(m?.enfasis)).toBe("$ 15.000");
  });
  it("sin progreso o sin nada que informar: null", () => {
    expect(metaCuotasFicha(null)).toBeNull();
    expect(metaCuotasFicha(undefined)).toBeNull();
    expect(metaCuotasFicha({ cuotasActuales: null, proximo: null, pct: 100 })).toBeNull();
  });
  it("textos en usted, sin voseo", () => {
    const textos = [
      metaCuotasFicha({ cuotasActuales: 8, proximo: { cuotas: 12, falta: 1, minimo: 2 }, pct: 50 }),
      metaCuotasFicha({ cuotasActuales: 8, proximo: null, pct: 100 }),
      metaCuotasFicha({ cuotasActuales: null, proximo: { cuotas: 6, falta: 1, minimo: 2 }, pct: 50 }),
    ].flatMap((m) => [m?.texto, m?.textoAlcanzado]).filter(Boolean).join(" ");
    expect(textos).not.toMatch(/\b(tu|tus|te|vos|sumá|pagá|tenés)\b/i);
  });
});

describe("cuotasHastaFicha", () => {
  const op = (cuotas: number, total: number) => ({ cuotas, total, montoCuota: total / cuotas, sinInteres: true as const });

  it("el nivel mayor que el producto solo no alcanza, con su mínimo (el menor entre medios)", () => {
    const h = cuotasHastaFicha({
      medios: [
        { slug: "a", medio: "A", opciones: [op(6, 5382.06)], noAlcanzadas: [{ cuotas: 8, minimo: 30000 }, { cuotas: 12, minimo: 90000 }] },
        { slug: "b", medio: "B", opciones: [op(3, 5000)], noAlcanzadas: [{ cuotas: 12, minimo: 80000 }] },
      ],
    });
    expect(h).toEqual({ cuotas: 12, minimo: 80000 });
    expect(sinNbsp(TEXTOS_CUOTAS.hastaCuotasDesde(h!.cuotas, h!.minimo))).toBe(
      "Hasta 12 cuotas sin interés en compras desde $ 80.000",
    );
  });
  it("un nivel que otro medio ya ofrece para el producto, o menor que el que tiene: no cuenta", () => {
    expect(
      cuotasHastaFicha({
        medios: [
          { slug: "a", medio: "A", opciones: [op(3, 100)], noAlcanzadas: [{ cuotas: 6, minimo: 500 }] },
          { slug: "b", medio: "B", opciones: [op(12, 120)], noAlcanzadas: [{ cuotas: 8, minimo: 300 }] },
        ],
      }),
    ).toBeNull();
  });
  it("sin cuotas, sin mínimos o sin nada por arriba: null", () => {
    expect(cuotasHastaFicha(undefined)).toBeNull();
    expect(cuotasHastaFicha({ medios: [{ slug: "a", medio: "A", opciones: [op(6, 600)] }] })).toBeNull();
  });
  it("el producto solo no tiene cuotas: igual informa el nivel mayor", () => {
    expect(
      cuotasHastaFicha({ medios: [{ slug: "a", medio: "A", opciones: [], noAlcanzadas: [{ cuotas: 3, minimo: 10000 }, { cuotas: 6, minimo: 20000 }] }] }),
    ).toEqual({ cuotas: 6, minimo: 20000 });
  });
});
