import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Guarda del código fuente (patrón de PedidoDetalle.comprobante.test.ts): la línea del cupón en Mi cuenta. */
const detalle = readFileSync(join(__dirname, "PedidoDetalle.tsx"), "utf8");

describe("PedidoDetalle: cupón", () => {
  it("muestra la línea del cupón y los montos de antes del cupón", () => {
    expect(detalle).toContain("pedido.cupon.texto");
    expect(detalle).toContain("pedido.cupon?.subtotalAntes");
    expect(detalle).toContain("pedido.cupon?.ivaAntes");
  });
});
