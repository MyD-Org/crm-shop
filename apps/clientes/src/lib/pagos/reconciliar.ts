/**
 * Reconciliación de pagos pendientes contra el proveedor.
 *
 * El webhook es la fuente de verdad, pero puede no llegar: cae la red del
 * proveedor, cae la nuestra, el operador borra el túnel en desarrollo, o MP
 * agota los reintentos. Sin este barrido, un pedido cobrado en MP quedaría en
 * `pendiente` en nuestra DB para siempre y nadie se enteraría hasta que un
 * cliente reclame.
 *
 * Recorre INTENTOS (`pago_intentos`), no pedidos: un pedido puede tener un
 * intento viejo abierto además del último, y si se miraba sólo la referencia
 * del pedido ese pago nunca se volvía a consultar.
 *
 * Corre desde un cron. La política es conservadora: se ignoran los pedidos que
 * el webhook podría estar por procesar (menos de 5 minutos sin cambios) y los
 * demasiado viejos (más de 3 días), donde ya no vale seguir preguntando.
 *
 * NO hace nada distinto de lo que hace el webhook — pasa por el mismo
 * `registrarCobro`, que ya es idempotente y aplica las reglas de transición.
 * O sea: si el webhook llega justo cuando este cron está corriendo, el peor
 * caso es dos updates iguales, no un doble cobro.
 */

import { mercadoPago } from "./mercadopago";
import { intentosPendientesDeReconciliar, registrarCobro } from "@/lib/pedidos";

/**
 * Antigüedad mínima desde el último toque al pago antes de re-consultar. Menos
 * que esto y podríamos estar pisándonos con el webhook o con la propia
 * respuesta HTTP de creación del pago que todavía no terminó de escribir. Cinco
 * minutos es holgado: MP suele avisar en segundos.
 */
const ESPERA_WEBHOOK_MS = 5 * 60_000;

/**
 * Corte máximo hacia atrás. Después de 3 días un pago abierto se cierra en MP
 * (expira o queda en un estado terminal), así que insistir con la consulta no
 * cambia el resultado y sí gasta cuota de API.
 */
const VENTANA_MS = 3 * 24 * 60 * 60_000;

export interface ResultadoReconciliacion {
  revisados: number;
  actualizados: number;
  errores: number;
}

interface Opciones {
  /** Corte máximo de pedidos por corrida. Acota el tiempo del cron. */
  limite?: number;
  /** Solo se reconcilian pedidos de este proveedor. */
  proveedor?: string;
}

/**
 * Recorre los pendientes vivos y les pregunta al proveedor cómo terminaron.
 * Devuelve el conteo para el log del cron.
 */
export async function reconciliarPagosPendientes(
  opciones: Opciones = {},
): Promise<ResultadoReconciliacion> {
  const { limite = 100, proveedor = mercadoPago.id } = opciones;
  const ahora = Date.now();
  const corteWebhook = new Date(ahora - ESPERA_WEBHOOK_MS);
  const corteAntiguedad = new Date(ahora - VENTANA_MS);

  const candidatos = await intentosPendientesDeReconciliar({
    proveedor,
    quietosDesde: corteWebhook,
    creadosDesde: corteAntiguedad,
    limite,
  });

  let actualizados = 0;
  let errores = 0;

  /**
   * Secuencial a propósito: en paralelo saturaríamos a MP con ráfagas que
   * dispararían su rate limit y no hay motivo para apurar — el cron corre en
   * background. Un pedido lento no debe frenar al siguiente, así que va con
   * try/catch por item.
   */
  for (const c of candidatos) {
    try {
      const estado = await mercadoPago.consultarPago(c.referencia);
      const cambio = await registrarCobro(c.orderId, {
        proveedor,
        referencia: c.referencia,
        estado: estado.estado,
        detalle: estado.detalle,
        reversion: estado.reversion,
        cuotas: estado.cuotasPagadas,
        totalPagado: estado.totalPagado,
      });
      if (cambio) actualizados++;
    } catch (err) {
      errores++;
      console.error(
        `[reconciliar] pedido=${c.orderId} referencia=${c.referencia}:`,
        err,
      );
    }
  }

  return { revisados: candidatos.length, actualizados, errores };
}
