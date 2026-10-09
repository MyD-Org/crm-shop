import { describe, expect, it } from "vitest";
import { MAX_LINEAS } from "./carrito-cliente";
import { parsearCompartido } from "./carrito-compartido";
import { AVISO_PEDIDO_RECORTADO, pedidoCompartible } from "./pedido-compartir";

const linea = (n: number) => ({ id: String(1000 + n), qty: (n % 5) + 1 });

describe("pedidoCompartible", () => {
  it("arma id:qty en orden", () => {
    const r = pedidoCompartible([
      { id: "12", qty: 3 },
      { id: "5", qty: 1 },
    ]);
    expect(r.href).toBe("/carrito/compartido?i=12:3,5:1");
    expect(r).toMatchObject({ lineas: 2, recortado: false });
  });

  it("el link no lleva nada del pedido (sólo ids y cantidades)", () => {
    const { href } = pedidoCompartible([
      { id: "12", qty: 3, name: "X", price: 999, total: 2997, numero: 4521 } as never,
    ]);
    expect(href).toBe("/carrito/compartido?i=12:3");
    expect(href).not.toMatch(/4521|999|2997/);
  });

  it("75 líneas: el link trae 60 y avisa", () => {
    const items = Array.from({ length: 75 }, (_, n) => linea(n));
    const r = pedidoCompartible(items);
    expect(r.recortado).toBe(true);
    expect(r.lineas).toBe(MAX_LINEAS);
    expect(parsearCompartido(new URL(r.href, "https://x.example").searchParams.get("i"))).toHaveLength(MAX_LINEAS);
    expect(AVISO_PEDIDO_RECORTADO).toContain("60");
  });

  it("exactamente 60 no avisa", () => {
    const r = pedidoCompartible(Array.from({ length: 60 }, (_, n) => linea(n)));
    expect(r.recortado).toBe(false);
  });

  it("omite ítems sin id válido o cantidad inválida", () => {
    const r = pedidoCompartible([
      { id: "", qty: 1 },
      { id: "abc", qty: 1 },
      { id: "7", qty: 0 },
      { id: "8", qty: 2 },
    ]);
    expect(r.href).toBe("/carrito/compartido?i=8:2");
    expect(r.lineas).toBe(1);
  });
});
