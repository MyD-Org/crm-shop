import { describe, expect, it } from "vitest";
import { ignorarProblemasDeStock, type Cotizacion, type LineaCotizada } from "./cotizacion";

const base = (id: string, total: number, problema?: LineaCotizada["problema"]): LineaCotizada => ({
  id,
  code: null,
  name: id,
  brand: "",
  qty: 1,
  precioUnitario: total / 1.21,
  ivaPorcentaje: 21,
  subtotal: Math.round((total / 1.21) * 100) / 100,
  iva: Math.round((total - total / 1.21) * 100) / 100,
  total,
  stockDisponible: 0,
  ...(problema ? { problema, detalle: "x" } : {}),
});

const cot = (lineas: LineaCotizada[]): Cotizacion => ({
  lineas,
  subtotal: 0,
  iva: 0,
  costoEnvio: 0,
  total: 0,
  hayProblemas: lineas.some((l) => l.problema),
  listaPrivada: false,
});

describe("ignorarProblemasDeStock", () => {
  it("descarta sin_stock y stock_insuficiente y rehace los totales con todas las líneas", () => {
    const r = ignorarProblemasDeStock(cot([base("a", 121, "sin_stock"), base("b", 242, "stock_insuficiente")]));
    expect(r.hayProblemas).toBe(false);
    expect(r.total).toBeCloseTo(363, 1);
    expect(r.lineas.every((l) => !l.problema && !l.detalle)).toBe(true);
  });

  it("deja bloqueando lo demás (sin precio, inactivo, inexistente)", () => {
    for (const p of ["sin_precio", "inactivo", "no_encontrado"] as const) {
      const r = ignorarProblemasDeStock(cot([base("a", 121, "sin_stock"), base("b", 121, p)]));
      expect(r.hayProblemas).toBe(true);
    }
  });
});
