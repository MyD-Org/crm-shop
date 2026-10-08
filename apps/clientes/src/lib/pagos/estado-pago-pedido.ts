/**
 * Estado del pago de un pedido para SU comprador. SOLO servidor.
 *
 * El caso que resuelve: un procesador que tarda en responder deja el pedido `pendiente` y la
 * conciliación (cron) puede demorar. Acá el propio comprador dispara la consulta: si el pedido tiene
 * un intento abierto con referencia, se le pregunta al procesador (sólo CONSULTA, nunca cancela) y se
 * registra por `registrarCobro`, el mismo camino del webhook y de la conciliación, que es quien
 * dispara los avisos (`pago_recibido` / `pago_rechazado`) al cambiar el estado del pedido.
 *
 * Nada sensible sale: ni el detalle crudo del procesador ni la referencia, sólo el estado y un
 * mensaje ya traducido.
 */

import type { PagoEstado } from "@/data/orders";
import { esPagoEnLinea } from "@/lib/medios-pago";
import {
  getPedidoParaPago,
  intentoAbiertoDelPedido,
  motivoNoCobrable,
  registrarCobro,
  type DuenoPedidos,
} from "@/lib/pedidos";
import { proveedorPago } from "@/lib/pagos";
import { conciliarIntento } from "./conciliar-intento";
import { MENSAJE_RECHAZO } from "./tipos";

export interface EstadoPagoPedido {
  estado: PagoEstado;
  /** El pedido se cobra en línea (con otro medio el estado es el del pedido, sin consultar a nadie). */
  enLinea: boolean;
  /** Sólo con `estado: "fallido"`: qué pasó y qué hacer, ya traducido. */
  mensaje?: string;
  /** Todavía se puede volver a pagar este mismo pedido (no está cancelado, tomado ni vencido). */
  cobrable: boolean;
  /**
   * Pago en línea pendiente SIN ningún cobro en curso: el envío nunca llegó al procesador (se cortó la
   * conexión antes de reservar el intento). No hay nada que esperar: el comprador puede reintentar.
   */
  sinCobro?: boolean;
}

export async function estadoPagoDelPedido(
  id: string,
  dueno: DuenoPedidos,
  /**
   * `payment_id` con el que el comprador volvió de Mercado Pago (cuenta de Mercado Pago). Ese flujo no
   * reserva intento: si el webhook todavía no llegó (o se perdió), nadie conoce ese pago. Se le
   * pregunta a Mercado Pago y, si es de ESTE pedido, se registra como lo haría el webhook.
   */
  opciones: { pagoMercadoPagoId?: string } = {},
): Promise<EstadoPagoPedido | null> {
  let pedido = await getPedidoParaPago(id, dueno);
  if (!pedido) return null;

  const enLinea = esPagoEnLinea(pedido.pagoMetodo);
  let mensaje: string | undefined;
  let sinCobro = false;

  if (enLinea && pedido.pagoEstado !== "pagado" && opciones.pagoMercadoPagoId) {
    const mp = proveedorPago("mercadopago");
    if (mp?.configurado()) {
      try {
        const estado = await mp.consultarPago(opciones.pagoMercadoPagoId);
        // Un id ajeno (de otro pedido o de otro comprador) no se registra en éste.
        if (estado.pedidoId === id) {
          await registrarCobro(id, {
            proveedor: mp.id,
            referencia: opciones.pagoMercadoPagoId,
            estado: estado.estado,
            detalle: estado.detalle,
            reversion: estado.reversion,
            cuotas: estado.cuotasPagadas,
            totalPagado: estado.totalPagado,
            ...(estado.info ? { info: estado.info } : {}),
          });
          if (estado.estado === "fallido" && estado.motivo) mensaje = MENSAJE_RECHAZO[estado.motivo];
          pedido = (await getPedidoParaPago(id, dueno)) ?? pedido;
        }
      } catch (err) {
        // Sin respuesta de Mercado Pago sigue como estaba: el webhook o la conciliación lo retoman.
        console.error(`[estado-pago] pedido=${id} pago_mp:`, err);
      }
    }
  }

  if (enLinea && pedido.pagoEstado === "pendiente") {
    const abierto = await intentoAbiertoDelPedido(id, dueno);
    sinCobro = abierto === null;
    const proveedor = abierto?.referencia ? proveedorPago(abierto.proveedor) : null;
    if (abierto?.referencia && proveedor && proveedor.configurado()) {
      try {
        const { estado } = await conciliarIntento(proveedor, {
          orderId: id,
          referencia: abierto.referencia,
          creadoEn: abierto.creadoEn,
        });
        if (estado.estado === "fallido" && estado.motivo) mensaje = MENSAJE_RECHAZO[estado.motivo];
        // El estado del pedido lo decide el conjunto de sus intentos: se vuelve a leer.
        pedido = (await getPedidoParaPago(id, dueno)) ?? pedido;
      } catch (err) {
        // Sin respuesta del procesador sigue "pendiente": la conciliación lo retoma.
        console.error(`[estado-pago] pedido=${id}:`, err);
      }
    }
  }

  return {
    estado: pedido.pagoEstado,
    enLinea,
    ...(pedido.pagoEstado === "fallido" ? { mensaje: mensaje ?? MENSAJE_RECHAZO.desconocido } : {}),
    cobrable: motivoNoCobrable(pedido) === null,
    ...(sinCobro && pedido.pagoEstado === "pendiente" ? { sinCobro: true } : {}),
  };
}
