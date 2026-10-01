/**
 * Qué cuenta para transferir se muestra en el detalle del pedido de Mi cuenta. Se muestra lo
 * congelado en el pedido (`orders.pago_cuenta`): NUNCA se vuelve a resolver, así que editar o
 * desactivar la cuenta después no cambia lo que vio quien compró. Un pedido sin snapshot (sin
 * cuenta aplicable o anterior a la migración) lleva el mensaje neutro, sin datos bancarios.
 */
import type { Order } from "@/data/orders";
import { SLUG_TRANSFERENCIA, type CuentaPagoSnapshot } from "./cuentas-bancarias";

export function cuentaDelPedido(
  pedido: Pick<Order, "pagoMetodoSlug" | "estado" | "pagoEstado" | "cuentaPago">,
): { mostrar: boolean; cuenta: CuentaPagoSnapshot | null } {
  const aTransferir =
    pedido.pagoMetodoSlug === SLUG_TRANSFERENCIA && pedido.estado !== "cancelado" && pedido.pagoEstado !== "pagado";
  return aTransferir ? { mostrar: true, cuenta: pedido.cuentaPago ?? null } : { mostrar: false, cuenta: null };
}
