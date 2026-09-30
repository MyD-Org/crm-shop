import type { PedidoRow } from "@/lib/pedidos-repo"

// Vencimiento de la reserva de un pedido PENDIENTE sin pago (change `sucursales-igz-mdp`,
// rebanada B). Puro. `shop.orders.reserva_vence_en` es un snapshot de `crearPedido`: NULL = pedido
// anterior (24 h desde la creación de siempre); `infinity` = la regla "nunca vence". Un pedido ya
// confirmado, pagado o facturado reserva hasta entregar o cancelar: no tiene vencimiento que
// mostrar ni extender.

export const VENTANA_PENDIENTE_HORAS = 24

export interface ReservaPedido {
  /** ISO del vencimiento; null = sin vencimiento. */
  venceEn: string | null
}

const esInfinito = (d: Date) => !Number.isFinite(d.getTime())

/** null = la reserva no depende de un vencimiento (no es un pendiente sin pago). */
export function reservaDePendiente(
  row: Pick<PedidoRow, "estado" | "pagoEstado" | "facturadoEn" | "createdAt" | "reservaVenceEn">,
): ReservaPedido | null {
  if (row.estado !== "pendiente" || row.pagoEstado === "pagado" || row.facturadoEn) return null
  const v = row.reservaVenceEn
  if (v === null) return { venceEn: new Date(row.createdAt.getTime() + VENTANA_PENDIENTE_HORAS * 3_600_000).toISOString() }
  if (esInfinito(v)) return { venceEn: null }
  return { venceEn: v.toISOString() }
}
