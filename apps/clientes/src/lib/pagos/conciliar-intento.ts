/**
 * Consulta un intento de cobro al procesador y registra lo que responda. SOLO servidor.
 *
 * Es lo que comparten la conciliación (cron) y la consulta del propio comprador
 * (`GET /api/pedidos/[id]/pago`): las dos pasan por `registrarCobro`, que es idempotente, aplica las
 * reglas de transición y dispara los avisos (`pago_recibido` / `pago_rechazado`) sólo cuando el estado
 * del pedido cambia. Sólo CONSULTA: nunca cancela el pago (a diferencia de `resolverIntentoAbierto`).
 */

import { registrarCobro } from "@/lib/pedidos";
import { darPorPerdidoSiCorresponde } from "./intento-abierto";
import type { EstadoPago, ProveedorPago } from "./tipos";

export async function conciliarIntento(
  proveedor: ProveedorPago,
  intento: { orderId: string; referencia: string; creadoEn?: Date },
): Promise<{ estado: EstadoPago; cambio: boolean }> {
  // Un proveedor que no conoce el pago (Payway) lo deja `pendiente` hasta que el intento es lo
  // bastante viejo como para darlo por "no llegó".
  const estado = darPorPerdidoSiCorresponde(
    await proveedor.consultarPago(intento.referencia),
    intento.creadoEn,
  );
  const cambio = await registrarCobro(intento.orderId, {
    proveedor: proveedor.id,
    referencia: intento.referencia,
    estado: estado.estado,
    detalle: estado.detalle,
    reversion: estado.reversion,
    cuotas: estado.cuotasPagadas,
    totalPagado: estado.totalPagado,
    moneda: estado.moneda,
    ...(estado.info ? { info: estado.info } : {}),
  });
  return { estado, cambio };
}
