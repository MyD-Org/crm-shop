import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { formatearNumeroPedido } from "./pedidos-repo"
import type { Tx } from "./precios-online-repo"

// Canjes de una promoción: viven en el Shop (`shop.cupon_canjes`, migración 0042 del Shop) y su
// estado se CALCULA desde el pedido, con los mismos predicados que el Shop
// (apps/clientes/src/lib/pedido-vivo.ts): si cambian allá, cambian acá.
//   - canjeado: el pedido está pagado o avanzó de estado;
//   - reservado: el pedido sigue vivo (pendiente con la reserva vigente) y no se canjeó;
//   - liberado: el resto (cancelado, o pendiente con la reserva vencida).
// `duplicado`: dos pedidos canjeados con el mismo código único (un pago tardío de un pedido
// liberado cuyo código ya se usó en otro; decisión de la spec: se acepta y se marca).

export type EstadoCanje = "reservado" | "canjeado" | "liberado"

export interface CanjeDto {
  pedidoId: string
  /** Visible, como lo nombra el comprador ("PED-00001042"). */
  numero: string
  fecha: string
  estado: EstadoCanje
  duplicado: boolean
  /** Con IVA. */
  descuento: number
}

const COMPRADO = sql`(o.pago_estado = 'pagado' OR o.estado IN ('confirmado', 'preparacion', 'en_camino', 'entregado'))`
const VIVO = sql`(o.estado <> 'cancelado' AND (o.estado <> 'pendiente' OR o.pago_estado = 'pagado' OR coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now()))`
const ESTADO = sql`CASE WHEN ${COMPRADO} THEN 'canjeado' WHEN ${VIVO} THEN 'reservado' ELSE 'liberado' END`

/** Canjes de la promoción (cualquier estado): con alguno no se cambia el tipo ni el % ni se elimina. */
export async function contarCanjes(tx: Tx, promocionId: string): Promise<number> {
  const [r] = (await tx.execute(
    sql`SELECT count(*)::int AS n FROM shop.cupon_canjes WHERE promocion_id = ${promocionId}::uuid`,
  )) as unknown as { n: number }[]
  return Number(r?.n ?? 0)
}

/** Detalle de la promoción: sus canjes con el estado calculado, el más nuevo primero. */
export async function listarCanjes(tenantId: string, promocionId: string): Promise<CanjeDto[]> {
  const filas = (await getDb().execute(sql`
    WITH k AS (
      SELECT c.order_id, c.codigo_id, c.descuento_total, c.created_at, o.numero, ${ESTADO} AS estado,
             p.tipo
      FROM shop.cupon_canjes c
      JOIN shop.orders o ON o.id = c.order_id
      JOIN cupon_promociones p ON p.id = c.promocion_id
      WHERE c.tenant_id = ${tenantId} AND c.promocion_id = ${promocionId}::uuid
    )
    SELECT k.order_id, k.numero, k.created_at, k.estado, k.descuento_total,
           (k.tipo = 'unicos' AND k.estado = 'canjeado' AND EXISTS (
              SELECT 1 FROM k k2 WHERE k2.codigo_id = k.codigo_id AND k2.order_id <> k.order_id AND k2.estado = 'canjeado'
           )) AS duplicado
    FROM k
    ORDER BY k.created_at DESC, k.order_id
  `)) as unknown as {
    order_id: string
    numero: number
    created_at: Date | string
    estado: EstadoCanje
    descuento_total: string
    duplicado: boolean
  }[]
  return filas.map((f) => ({
    pedidoId: f.order_id,
    numero: formatearNumeroPedido(Number(f.numero)),
    fecha: new Date(f.created_at).toISOString(),
    estado: f.estado,
    duplicado: Boolean(f.duplicado),
    descuento: Number(f.descuento_total),
  }))
}

/** Por promoción del tenant: canjes canjeados y descuento otorgado (con IVA) en ellos. */
export async function resumenCanjes(tenantId: string): Promise<Map<string, { usados: number; descuento: number }>> {
  const filas = (await getDb().execute(sql`
    SELECT c.promocion_id, count(*)::int AS usados, coalesce(sum(c.descuento_total), 0)::float8 AS descuento
    FROM shop.cupon_canjes c
    JOIN shop.orders o ON o.id = c.order_id
    WHERE c.tenant_id = ${tenantId} AND ${COMPRADO}
    GROUP BY c.promocion_id
  `)) as unknown as { promocion_id: string; usados: number; descuento: number }[]
  return new Map(filas.map((f) => [f.promocion_id, { usados: Number(f.usados), descuento: Number(f.descuento) }]))
}
