import { describe, expect, it } from "vitest";
import { disponibleTotal } from "./aviso-reingreso-elegibilidad";

const bruta = (o: {
  stock?: Record<string, number> | null;
  reservado?: Record<string, number>;
  oculto?: string[];
}): Parameters<typeof disponibleTotal>[0] => ({
  stockPorSucursal: { P: o.stock === undefined ? { igz: 0, mdp: 0 } : o.stock },
  reservadoPorSucursal: o.reservado ? { P: o.reservado } : ({} as Record<string, Record<string, number>>),
  ocultoEn: o.oculto ? { P: o.oculto } : ({} as Record<string, string[]>),
});

describe("disponibleTotal", () => {
  it("suma el disponible de todas las sucursales vendibles", () => {
    expect(disponibleTotal(bruta({ stock: { igz: 2, mdp: 3 } }), "P", ["igz", "mdp"])).toBe(5);
  });

  it("bruto 1 y reservado 1 es 0 (no se avisa con lo que ya está apartado)", () => {
    expect(disponibleTotal(bruta({ stock: { igz: 1, mdp: 0 }, reservado: { igz: 1 } }), "P", ["igz", "mdp"])).toBe(0);
  });

  it("la reserva de una sucursal no resta a otra, y nunca es negativo", () => {
    expect(disponibleTotal(bruta({ stock: { igz: 1, mdp: 4 }, reservado: { igz: 5 } }), "P", ["igz", "mdp"])).toBe(4);
  });

  it("no cuenta las sucursales donde el producto está oculto", () => {
    expect(disponibleTotal(bruta({ stock: { igz: 0, mdp: 7 }, oculto: ["mdp"] }), "P", ["igz", "mdp"])).toBe(0);
  });

  it("no cuenta las sucursales inactivas", () => {
    expect(disponibleTotal(bruta({ stock: { igz: 0, mdp: 7 } }), "P", ["igz"])).toBe(0);
  });

  it("stock NULL es no inventariable: null, nunca 0", () => {
    expect(disponibleTotal(bruta({ stock: null }), "P", ["igz", "mdp"])).toBeNull();
  });
});
