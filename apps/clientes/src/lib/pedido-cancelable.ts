import type { Order } from "@/data/orders";

/**
 * Regla de Mi cuenta: el cliente puede cancelar su pedido mientras esté
 * pendiente, sin pagar y sin factura, sea cual sea el medio de pago (a
 * coordinar, transferencia, Mercado Pago). El servidor la vuelve a verificar
 * (`cancelarPedidoPendiente`) y además cierra o rechaza un pago en curso.
 */
export function puedeCancelarPedido(
  pedido: Pick<Order, "estado" | "pagoEstado" | "facturaId" | "facturaNumero">,
): boolean {
  return (
    pedido.estado === "pendiente" &&
    pedido.pagoEstado !== "pagado" &&
    !pedido.facturaId &&
    !pedido.facturaNumero
  );
}
