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

import { idsProveedores, proveedorPago } from "./index";
import type { ProveedorPago } from "./tipos";
import { intentosPendientesDeReconciliar } from "@/lib/pedidos";
import { conciliarIntento } from "./conciliar-intento";

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

/**
 * Un intento dado por "no llegó" (el procesador no lo conocía a los 10 minutos) se sigue consultando
 * este tiempo: si el procesador lo aprueba tarde, se registra en vez de quedar cobrado sin registrar.
 */
const VENTANA_NO_LLEGO_MS = 24 * 60 * 60_000;

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
 * Recorre los pendientes vivos de cada proveedor registrado (o sólo del indicado) y les pregunta al
 * proveedor de cada intento cómo terminaron. Un proveedor que no está en el registro se omite sin
 * romper el lote. Devuelve el conteo para el log del cron.
 */
export async function reconciliarPagosPendientes(
  opciones: Opciones = {},
): Promise<ResultadoReconciliacion> {
  const { limite = 100, proveedor } = opciones;
  const ids = proveedor ? [proveedor] : idsProveedores();
  const total: ResultadoReconciliacion = { revisados: 0, actualizados: 0, errores: 0 };
  for (const id of ids) {
    const p = proveedorPago(id);
    if (!p) continue;
    // Sin credenciales no se puede consultar: cada intento daría error. (Tampoco hay nada que
    // reconciliar de un procesador que nunca se activó.)
    if (p.configurado && !p.configurado()) continue;
    const r = await reconciliarProveedor(p, limite);
    total.revisados += r.revisados;
    total.actualizados += r.actualizados;
    total.errores += r.errores;
  }
  return total;
}

async function reconciliarProveedor(
  proveedor: ProveedorPago,
  limite: number,
): Promise<ResultadoReconciliacion> {
  const ahora = Date.now();
  const corteWebhook = new Date(ahora - ESPERA_WEBHOOK_MS);
  const corteAntiguedad = new Date(ahora - VENTANA_MS);

  const candidatos = await intentosPendientesDeReconciliar({
    proveedor: proveedor.id,
    quietosDesde: corteWebhook,
    creadosDesde: corteAntiguedad,
    noLlegoDesde: new Date(ahora - VENTANA_NO_LLEGO_MS),
    limite,
  });

  let actualizados = 0;
  let errores = 0;

  /**
   * Secuencial a propósito: en paralelo saturaríamos al proveedor con ráfagas que
   * dispararían su rate limit y no hay motivo para apurar — el cron corre en
   * background. Un pedido lento no debe frenar al siguiente, así que va con
   * try/catch por item.
   */
  for (const c of candidatos) {
    try {
      const { cambio } = await conciliarIntento(proveedor, c);
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
