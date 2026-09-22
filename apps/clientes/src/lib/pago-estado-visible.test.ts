import { describe, expect, it } from "vitest";
import { ocultarEstadoPago } from "./pago-estado-visible";

/**
 * Con los pagos apagados TODOS los pedidos nuevos quedan con pago "pendiente"
 * para siempre (el pago se coordina por fuera). Mostrarle "Pago pendiente" al
 * comprador en cada pedido le dice que debe algo que no tiene cómo pagar acá.
 */
describe("ocultarEstadoPago", () => {
  it("pagos apagados: oculta sólo el 'pendiente'", () => {
    expect(ocultarEstadoPago("pendiente", false)).toBe(true);
    // Lo que sí pasó se sigue mostrando: son pedidos de cuando se cobraba.
    expect(ocultarEstadoPago("pagado", false)).toBe(false);
    expect(ocultarEstadoPago("fallido", false)).toBe(false);
  });

  it("pagos prendidos: no oculta nada, como siempre", () => {
    expect(ocultarEstadoPago("pendiente", true)).toBe(false);
    expect(ocultarEstadoPago("pagado", true)).toBe(false);
    expect(ocultarEstadoPago("fallido", true)).toBe(false);
  });
});
