import type { PagoEstado } from "@/data/orders";

/**
 * ¿Se esconde el estado del pago de un pedido en Mi cuenta?
 *
 * Con los pagos apagados ningún pedido se paga en el Shop: todos quedan en
 * "pendiente" y la etiqueta "Pago pendiente" sólo confunde. "Pagado" y "Pago
 * rechazado" son hechos de cuando se cobraba, así que se siguen mostrando.
 *
 * Puro a propósito: lo usan componentes de cliente, que no pueden leer el env.
 * El booleano lo resuelve la página en el server (src/lib/pagos-flag.ts).
 */
export function ocultarEstadoPago(
  pagoEstado: PagoEstado,
  pagosHabilitados: boolean,
): boolean {
  return !pagosHabilitados && pagoEstado === "pendiente";
}
