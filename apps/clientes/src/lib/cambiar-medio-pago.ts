/**
 * "Cambiar medio de pago" desde la pantalla de cobro en línea.
 *
 * Diseño: el MISMO pedido (mismo id y número). El botón vuelve al paso Pago con lo cargado y, al
 * confirmar, el cliente llama a `POST /api/pedidos/:id/medio` en vez de crear un pedido. El servidor
 * (`cambiarMedioPedido`, una transacción con el lock del pedido) valida dueño, estado pendiente, que no
 * haya cobro en vuelo, pago aprobado ni comprobante informado (409 en usted), revalida que el medio sea
 * ofrecible y recotiza con las mismas funciones que crear (`cotizarConMedio`). Las cantidades no cambian:
 * la reserva se mantiene. El mail de "pedido recibido" sale sólo si el medio nuevo es sin cobro en línea.
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
