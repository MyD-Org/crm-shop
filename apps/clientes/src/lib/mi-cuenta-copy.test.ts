import { describe, expect, it } from "vitest";
import { etiquetaContador } from "./mi-cuenta-copy";

describe("etiquetaContador", () => {
  it("1 en singular; 0 y el resto en plural", () => {
    expect(etiquetaContador(1, "Pedido en curso", "Pedidos en curso")).toBe("Pedido en curso");
    expect(etiquetaContador(0, "Pedido en curso", "Pedidos en curso")).toBe("Pedidos en curso");
    expect(etiquetaContador(28, "Producto en el carrito", "Productos en el carrito")).toBe(
      "Productos en el carrito",
    );
  });
});
