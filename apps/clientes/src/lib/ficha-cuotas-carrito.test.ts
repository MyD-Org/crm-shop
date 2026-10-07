import { describe, expect, it } from "vitest";
import { lineasConProducto, metaCuotasFicha } from "./ficha-cuotas-carrito";

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
  it("llega: éxito, con énfasis en las cuotas", () => {
    const m = metaCuotasFicha({ cuotasActuales: 6, proximo: null, pct: 100 });
    expect(m).toMatchObject({ id: "cuotas", alcanzada: true, pct: 100 });
    expect(m?.texto).toBe("Con su carrito, este producto entra en 6 cuotas sin interés.");
    expect(m?.enfasis).toBe("6 cuotas");
  });
  it("llega a un escalón y hay otro más alto: gana el que ya tiene", () => {
    const m = metaCuotasFicha({ cuotasActuales: 3, proximo: { cuotas: 6, falta: 100, minimo: 500 }, pct: 80 });
    expect(m?.alcanzada).toBe(true);
    expect(m?.texto).toBe("Con su carrito, este producto entra en 3 cuotas sin interés.");
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
});
