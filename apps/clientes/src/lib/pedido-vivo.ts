/**
 * Cuándo un pedido de la tienda "sigue tomando" algo (stock, unidades de campaña, un canje de cupón)
 * y cuándo cuenta como compra hecha. Un solo lugar para que los tres no se separen.
 *
 * - Vivo: no cancelado y pagado, avanzado de estado o pendiente con la reserva viva
 *   (`coalesce(reserva_vence_en, created_at + 24 h) > now()`; `'infinity'` = sin vencimiento).
 * - Comprado: pagado o avanzado de estado (lo que el CRM muestra como "canjeado" y lo que cuenta
 *   para "sólo primera compra").
 */
import { sql, type SQL } from "drizzle-orm";

const ALIAS_RE = /^[a-z_][a-z0-9_]*$/;

function alias(a: string): SQL {
  if (!ALIAS_RE.test(a)) throw new Error(`alias inválido: ${a}`);
  return sql.raw(a);
}

export function pedidoVivoSql(a: string): SQL {
  const o = alias(a);
  return sql`(${o}.estado <> 'cancelado' and (${o}.estado <> 'pendiente' or ${o}.pago_estado = 'pagado' or coalesce(${o}.reserva_vence_en, ${o}.created_at + interval '24 hours') > now()))`;
}

export function pedidoCompradoSql(a: string): SQL {
  const o = alias(a);
  return sql`(${o}.pago_estado = 'pagado' or ${o}.estado in ('confirmado', 'preparacion', 'en_camino', 'entregado'))`;
}
