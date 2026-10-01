import { describe, expect, it } from "vitest";
import { ocultarEstadoPago } from "./pago-estado-visible";

/**
 * "Pago pendiente" sólo tiene sentido en un pedido que se cobra en línea (Mercado Pago). Un pedido
 * con transferencia o efectivo queda "a confirmar": decirle al comprador que tiene un pago
 * pendiente en el Shop sería confuso. Lo decide cada pedido, no un flag global.
 */
describe("ocultarEstadoPago", () => {
  it("pedido que no es de Mercado Pago: oculta sólo el 'pendiente'", () => {
    expect(ocultarEstadoPago("pendiente", "transferencia")).toBe(true);
    expect(ocultarEstadoPago("pendiente", "a_coordinar")).toBe(true);
    expect(ocultarEstadoPago("pendiente", undefined)).toBe(true);
    expect(ocultarEstadoPago("pagado", "transferencia")).toBe(false);
    expect(ocultarEstadoPago("fallido", "transferencia")).toBe(false);
  });

  it("pedido de Mercado Pago: no oculta nada", () => {
    expect(ocultarEstadoPago("pendiente", "mercadopago")).toBe(false);
    expect(ocultarEstadoPago("pagado", "mercadopago")).toBe(false);
    expect(ocultarEstadoPago("fallido", "mercadopago")).toBe(false);
  });
});
