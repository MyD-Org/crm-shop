import { describe, expect, it } from "vitest";
import { mostrarAvisoReingreso } from "./aviso-reingreso-visibilidad";

const agotado = { stock: "out" as const, stockQty: 0 };

describe("mostrarAvisoReingreso", () => {
  it("agotado con el flag ON: se ofrece", () => {
    expect(mostrarAvisoReingreso({ habilitado: true, producto: agotado, noComprable: false })).toBe(true);
  });

  it("flag OFF: no se ofrece (queda solo 'Sin stock')", () => {
    expect(mostrarAvisoReingreso({ habilitado: false, producto: agotado, noComprable: false })).toBe(false);
  });

  it("con stock (en stock o últimas unidades): no se ofrece", () => {
    for (const producto of [
      { stock: "in" as const, stockQty: 40 },
      { stock: "low" as const, stockQty: 2 },
    ]) {
      expect(mostrarAvisoReingreso({ habilitado: true, producto, noComprable: false })).toBe(false);
    }
  });

  it("no inventariable (stock NULL): no se ofrece nunca", () => {
    expect(mostrarAvisoReingreso({ habilitado: true, producto: { stock: "in" }, noComprable: false })).toBe(false);
    expect(mostrarAvisoReingreso({ habilitado: true, producto: { stock: "out" }, noComprable: false })).toBe(false);
  });

  it("no comprable (sin precio o precio de cuenta pendiente): no se ofrece", () => {
    expect(mostrarAvisoReingreso({ habilitado: true, producto: agotado, noComprable: true })).toBe(false);
  });

  it("con modalidad de venta sin stock activa (a pedido): no se ofrece", () => {
    const producto = { ...agotado, ventaSinStock: { id: "m1", texto: "A pedido", plazoDias: 7, flujo: "a_confirmar" as const } };
    expect(mostrarAvisoReingreso({ habilitado: true, producto, noComprable: false })).toBe(false);
  });

  it("cambio de variante: la elegida con stock lo oculta, la agotada lo muestra", () => {
    const variantes = { a: agotado, b: { stock: "in" as const, stockQty: 10 } };
    const ver = (id: "a" | "b") => mostrarAvisoReingreso({ habilitado: true, producto: variantes[id], noComprable: false });
    expect([ver("a"), ver("b"), ver("a")]).toEqual([true, false, true]);
  });
});
