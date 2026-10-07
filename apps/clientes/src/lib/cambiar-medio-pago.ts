/**
 * "Cambiar medio de pago" desde la pantalla de cobro en línea.
 *
 * Diseño: se CANCELA el pedido pendiente (`POST /api/pedidos/:id/cancelar?para=cambiar-medio`, con su
 * lock, el chequeo del intento abierto y del comprobante informado) y se vuelve al paso Pago, donde
 * "Confirmar" crea un pedido nuevo por el camino normal (`POST /api/pedidos`): medio ofrecible, lista
 * de precios, cuotas, total congelado y reserva de stock se revalidan sin duplicar esa lógica. El
 * carrito sigue lleno (o el cancelar devuelve las líneas), así que un fallo a mitad de camino nunca
 * deja un pedido colgado ni al comprador sin carrito. El mail de "pedido recibido" sale sólo al
 * crear el pedido nuevo y sólo si su medio es sin cobro en línea (el cobro en línea avisa al pagarse).
 */

export type PasoDestino = "datos" | "pago";

/** Sólo se ofrece sin cobro aprobado ni en vuelo: formulario sin enviar o tras un rechazo. */
export function puedeCambiarMedioPago(e: { pagado: boolean; pagoEnConfirmacion: boolean }): boolean {
  return !e.pagado && !e.pagoEnConfirmacion;
}

/**
 * A qué paso se vuelve. Con el pedido creado en esta visita el formulario conserva entrega, dirección,
 * local, medio y cuotas: se cae en Pago. Un pedido retomado (recarga o `?pedido=`) no tiene ese
 * estado: se empieza por el primer paso.
 */
export function pasoAlCambiarMedio(e: { estadoCargado: boolean }): PasoDestino {
  return e.estadoCargado ? "pago" : "datos";
}
