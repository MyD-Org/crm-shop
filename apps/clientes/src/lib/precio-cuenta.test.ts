import { describe, expect, it } from "vitest";
import { precioPrivado } from "./precio-cuenta";

describe("precioPrivado", () => {
  it("devuelve el neto y el final con IVA", () => {
    expect(precioPrivado(1000, 21)).toEqual({ price: 1000, precioFinal: 1210 });
  });

  it("sin IVA conocido devuelve sólo el neto", () => {
    expect(precioPrivado(1000, null)).toEqual({ price: 1000 });
  });

  it("un precio mayor que el público no se descarta (no hay regla del 'menor que')", () => {
    expect(precioPrivado(5000, 21)?.price).toBe(5000);
  });

  it("sin precio, en cero o inválido: null (Consulte), nunca 0", () => {
    for (const n of [null, undefined, 0, -5, Number.NaN]) expect(precioPrivado(n, 21)).toBeNull();
  });
});
