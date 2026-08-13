/**
 * Reconciliación de pagos pendientes contra el proveedor.
 *
 * El webhook es la fuente de verdad, pero puede no llegar: cae la red del
 * proveedor, cae la nuestra, el operador borra el túnel en desarrollo, o MP
 * agota los reintentos. Sin este barrido, un pedido cobrado en MP quedaría en
 * `pendiente` en nuestra DB para siempre y nadie se enteraría hasta que un
 * cliente reclame.
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

import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { mercadoPago } from "./mercadopago";
import { registrarCobro } from "@/lib/pedidos";

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

  const candidatos = await getDb()
    .select({
      id: orders.id,
      referencia: orders.pagoReferencia,
    })
    .from(orders)
    .where(
      and(
        eq(orders.pagoEstado, "pendiente"),
        eq(orders.pagoProveedor, proveedor),
        isNotNull(orders.pagoReferencia),
        // El `coalesce` cubre el hueco de las órdenes cuyo webhook nunca llegó
        // y por eso no tienen `pago_actualizado_en`: en esos casos se cae al
        // `created_at`, que siempre existe.
        //
        // El corte va como ISO string a mano: en un template `sql` raw, el
        // driver de neon-http NO serializa `Date` — lo pasa crudo y se cae con
        // ERR_INVALID_ARG_TYPE. Los helpers tipados (`eq`, `gt`) sí saben
        // convertir, por eso `gt(orders.createdAt, ...)` de abajo va directo.
        sql`coalesce(${orders.pagoActualizadoEn}, ${orders.createdAt}) < ${corteWebhook.toISOString()}`,
        gt(orders.createdAt, corteAntiguedad),
      ),
    )
    .orderBy(orders.createdAt)
    .limit(limite);

  let actualizados = 0;
  let errores = 0;

  /**
   * Secuencial a propósito: en paralelo saturaríamos a MP con ráfagas que
   * dispararían su rate limit y no hay motivo para apurar — el cron corre en
   * background. Un pedido lento no debe frenar al siguiente, así que va con
   * try/catch por item.
   */
  for (const c of candidatos) {
    if (!c.referencia) continue;
    try {
      const estado = await mercadoPago.consultarPago(c.referencia);
      const cambio = await registrarCobro(c.id, {
        proveedor,
        referencia: c.referencia,
        estado: estado.estado,
        detalle: estado.detalle,
        reversion: estado.reversion,
      });
      if (cambio) actualizados++;
    } catch (err) {
      errores++;
      console.error(
        `[reconciliar] pedido=${c.id} referencia=${c.referencia}:`,
        err,
      );
    }
  }

  return { revisados: candidatos.length, actualizados, errores };
}
