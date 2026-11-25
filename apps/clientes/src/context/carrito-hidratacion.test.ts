import { describe, expect, it } from "vitest";
import { CARRITO_VACIO, type CartItem } from "@/lib/carrito-cliente";
import { vistaDeServidor } from "./carrito-hidratacion";

const item = { id: "1", name: "Lámpara", brand: "Marca", price: 100, qty: 2 } as CartItem;

describe("vistaDeServidor", () => {
  it("devuelve el carrito como lo pinta el servidor: vacío, sin cupón y sin ready", () => {
    const vista = vistaDeServidor({ items: [item], cupon: "BIENVENIDA", total: 200, count: 2, ready: true });
    expect(vista).toEqual({ items: CARRITO_VACIO, cupon: null, total: 0, count: 0, ready: false });
    expect(vista.items).toBe(CARRITO_VACIO);
  });

  it("conserva las acciones y el resto del valor", () => {
    const addItem = () => {};
    const cambio = { n: 3, sentido: 1 as const };
    const vista = vistaDeServidor({ items: [item], cupon: null, total: 200, count: 2, ready: true, addItem, cambio });
    expect(vista.addItem).toBe(addItem);
    expect(vista.cambio).toBe(cambio);
  });

  it("no modifica el valor original", () => {
    const original = { items: [item], cupon: "X", total: 200, count: 2, ready: true };
    vistaDeServidor(original);
    expect(original.items).toEqual([item]);
    expect(original.ready).toBe(true);
  });
});
