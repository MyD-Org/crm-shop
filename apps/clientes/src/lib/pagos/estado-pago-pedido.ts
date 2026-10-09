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
import { candidatasDelPedido, proveedorDeIntento } from "./cuentas-sucursales";
import { ErrorProveedor, MENSAJE_RECHAZO, esCredencialRechazada } from "./tipos";

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
    /**
     * La preferencia se creó con la cuenta prevista o, si sus credenciales fallaron, con otra: no se sabe
     * con cuál. Se consulta (sólo lectura) con cada cuenta usable, la prevista primero: la que conoce el
     * pago y dice que es de ESTE pedido es la cuenta del cobro; un 404 pasa a la siguiente.
     */
    const { prevista, candidatas } = await candidatasDelPedido("mercadopago", pedido);
    for (const c of candidatas.filter((x) => x.configurada && !x.rechazada)) {
      const mp = proveedorPago("mercadopago", c.cuenta);
      if (!mp) continue;
      try {
        const estado = await mp.consultarPago(opciones.pagoMercadoPagoId);
        // Un id ajeno (de otro pedido o de otro comprador) no se registra en éste.
        if (estado.pedidoId !== id) break;
        await registrarCobro(id, {
          proveedor: mp.id,
          referencia: opciones.pagoMercadoPagoId,
          estado: estado.estado,
          detalle: estado.detalle,
          reversion: estado.reversion,
          cuotas: estado.cuotasPagadas,
          totalPagado: estado.totalPagado,
          moneda: estado.moneda,
          ...(estado.info ? { info: estado.info } : {}),
          cuenta: c.cuenta,
          cuentaPrevista: prevista,
        });
        if (estado.estado === "fallido" && estado.motivo) mensaje = MENSAJE_RECHAZO[estado.motivo];
        pedido = (await getPedidoParaPago(id, dueno)) ?? pedido;
        break;
      } catch (err) {
        // Esta cuenta no conoce el pago (404) o no la deja consultar (credenciales): se prueba la siguiente.
        // Cualquier otro error corta: sigue como estaba y el webhook o la conciliación lo retoman.
        if ((err instanceof ErrorProveedor && err.status === 404) || esCredencialRechazada(err)) continue;
        console.error(`[estado-pago] pedido=${id} pago_mp cuenta=${c.cuenta}:`, err);
        break;
      }
    }
  }

  if (enLinea && pedido.pagoEstado === "pendiente") {
    const abierto = await intentoAbiertoDelPedido(id, dueno);
    sinCobro = abierto === null;
    // Con la cuenta congelada en el intento (o, si es anterior a la 0035, la del pedido).
    const proveedor = abierto?.referencia
      ? await proveedorDeIntento({
          proveedor: abierto.proveedor,
          cuenta: abierto.cuenta,
          sucursal: pedido.sucursal,
          facturaSucursal: pedido.facturaSucursal,
        })
      : null;
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
