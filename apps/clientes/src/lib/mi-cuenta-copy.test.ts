import { describe, expect, it } from "vitest";
import { fmtPrecio } from "./format";
import { etiquetaContador, textoEnvio } from "./mi-cuenta-copy";

describe("etiquetaContador", () => {
  it("1 en singular; 0 y el resto en plural", () => {
    expect(etiquetaContador(1, "Pedido en curso", "Pedidos en curso")).toBe("Pedido en curso");
    expect(etiquetaContador(0, "Pedido en curso", "Pedidos en curso")).toBe("Pedidos en curso");
    expect(etiquetaContador(28, "Producto en el carrito", "Productos en el carrito")).toBe(
      "Productos en el carrito",
    );
  });
});

describe("textoEnvio", () => {
  it("arma el texto con las ciudades y el mínimo de envio.ts", () => {
    expect(textoEnvio(["Ciudad A", "Ciudad B"], 100_000)).toBe(
      `Enviamos a Ciudad A y Ciudad B en compras desde ${fmtPrecio(100_000)} (sin IVA).`,
    );
  });

  it("una ciudad nueva aparece sin tocar el componente", () => {
    expect(textoEnvio(["Ciudad A", "Ciudad B", "Ciudad C"], 50_000)).toBe(
      `Enviamos a Ciudad A, Ciudad B y Ciudad C en compras desde ${fmtPrecio(50_000)} (sin IVA).`,
    );
    expect(textoEnvio(["Ciudad A"], 1)).toContain("Enviamos a Ciudad A en compras");
  });
});
