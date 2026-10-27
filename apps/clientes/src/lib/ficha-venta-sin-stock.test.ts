import { describe, expect, it } from "vitest";
import { estadoFicha } from "./ficha-venta-sin-stock";
import type { VentaSinStock } from "./venta-sin-stock";

const M: VentaSinStock = { id: "m1", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" };
const C: VentaSinStock = { id: "m2", texto: "A pedido", plazoDias: null, flujo: "a_confirmar" };

describe("estadoFicha", () => {
  it("a pedido en línea: texto, sin bloqueo, con cuotas", () =>
    expect(estadoFicha({ stock: "out", ventaSinStock: M })).toEqual({ texto: "Retiro en ~48 h", tono: "demora", agotado: false, aConfirmar: false }));
  it("a pedido a confirmar oculta cuotas", () => expect(estadoFicha({ stock: "out", ventaSinStock: C }).aConfirmar).toBe(true));
  it("con stock y modalidad: lo de hoy", () =>
    expect(estadoFicha({ stock: "in", ventaSinStock: C })).toEqual({ texto: "En stock", tono: "ok", agotado: false, aConfirmar: false }));
  it("sin modalidad y sin stock: agotado", () =>
    expect(estadoFicha({ stock: "out" })).toEqual({ texto: "Sin stock", tono: "no", agotado: true, aConfirmar: false }));
  it("últimas unidades: lo de hoy", () => expect(estadoFicha({ stock: "low" }).texto).toBe("Últimas unidades"));
});
