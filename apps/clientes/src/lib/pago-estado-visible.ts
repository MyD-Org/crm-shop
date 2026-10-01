import type { PagoEstado } from "@/data/orders";
import { esPagoEnLinea } from "./medios-pago";

/**
 * ¿Se esconde el estado del pago de un pedido en Mi cuenta?
 *
 * "Pago pendiente" sólo tiene sentido en un pedido que se cobra en línea (Mercado Pago). Un pedido
 * con transferencia, efectivo o "a coordinar" queda "a confirmar": ahí la etiqueta confunde. Lo
 * decide cada pedido por su `pago_metodo`, no un flag global. "Pagado" y "Pago rechazado" son
 * hechos y se muestran siempre.
 *
 * Puro a propósito: lo usan componentes de cliente.
 */
export function ocultarEstadoPago(
  pagoEstado: PagoEstado,
  pagoMetodo: string | null | undefined,
): boolean {
  return pagoEstado === "pendiente" && !esPagoEnLinea(pagoMetodo ?? "");
}
