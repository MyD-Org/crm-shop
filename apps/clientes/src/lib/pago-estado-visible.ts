import type { Order, PagoEstado } from "@/data/orders";
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

export interface PagoEstadoVista {
  label: string;
  /** Qué significa y qué hacer, cuando hace falta aclararlo. */
  detalle?: string;
}

/**
 * Cómo se muestra el estado del pago de un pedido en Mi cuenta (detalle): procesando, aprobado o
 * rechazado, dicho claro. `null` = no se muestra (un pedido que no se cobra en línea no tiene "pago
 * pendiente" que mostrar: ver `ocultarEstadoPago`). Puro: lo usan componentes de cliente.
 */
export function pagoEstadoVista(
  o: Pick<Order, "pagoEstado" | "pagoMetodoSlug" | "pagoEnProceso">,
): PagoEstadoVista | null {
  if (ocultarEstadoPago(o.pagoEstado, o.pagoMetodoSlug)) return null;
  if (o.pagoEstado === "pagado") return { label: "Pago aprobado" };
  if (o.pagoEstado === "fallido") {
    return {
      label: "Pago rechazado",
      detalle: "No se pudo completar el pago y no se le cobró. Puede intentarlo nuevamente o elegir otro medio de pago.",
    };
  }
  if (o.pagoEnProceso) {
    return {
      label: "Pago en proceso",
      detalle:
        "Estamos confirmando su pago con el procesador. Le enviaremos un correo cuando se resuelva; no hace falta que pague de nuevo.",
    };
  }
  return { label: "Pago pendiente" };
}
