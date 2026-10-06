import { describe, expect, it } from "vitest";
import { baseParaCuotas } from "./cuotas-sin-interes";
import type { Cotizacion, LineaCotizada } from "./cotizacion";

const linea = (o: Partial<LineaCotizada> = {}): LineaCotizada => ({
  id: "1", code: null, name: "P", brand: "", qty: 1, precioUnitario: 1000, ivaPorcentaje: 21,
  subtotal: 1000, iva: 210, total: 1210, stockDisponible: 5, ...o,
});
const cot = (lineas: LineaCotizada[], o: Partial<Cotizacion> = {}): Cotizacion => ({
  lineas, subtotal: 0, iva: 0, costoEnvio: 0, total: 0, hayProblemas: lineas.some((l) => l.problema),
  listaPrivada: false, ...o,
});

describe("baseParaCuotas", () => {
  it("cotización sana: su total", () => {
    expect(baseParaCuotas(cot([linea()], { total: 1210 }))).toBe(1210);
  });
  it("un problema de stock no anula la base: se suman las líneas con precio", () => {
    const c = cot([linea(), linea({ id: "2", problema: "stock_insuficiente" })], { total: 1210 });
    expect(baseParaCuotas(c)).toBe(2420);
  });
  it("una línea sin precio en la lista, inactiva o inexistente: no hay base (nunca se promete con base parcial)", () => {
    for (const problema of ["sin_precio", "inactivo", "no_encontrado"] as const) {
      expect(baseParaCuotas(cot([linea(), linea({ id: "2", problema, total: 0 })], { total: 1210 }))).toBeNull();
    }
  });
  it("base 0 o carrito vacío: null, nunca 0", () => {
    expect(baseParaCuotas(cot([], { total: 0 }))).toBeNull();
    expect(baseParaCuotas(cot([linea({ total: 0, subtotal: 0, iva: 0, precioUnitario: 0 })], { total: 0 }))).toBeNull();
  });
});
