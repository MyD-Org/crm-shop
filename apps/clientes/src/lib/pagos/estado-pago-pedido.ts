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
}

export async function estadoPagoDelPedido(
  id: string,
  dueno: DuenoPedidos,
): Promise<EstadoPagoPedido | null> {
  let pedido = await getPedidoParaPago(id, dueno);
  if (!pedido) return null;

  const enLinea = esPagoEnLinea(pedido.pagoMetodo);
  let mensaje: string | undefined;

  if (enLinea && pedido.pagoEstado === "pendiente") {
    const abierto = await intentoAbiertoDelPedido(id, dueno);
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
  };
}
