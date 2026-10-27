import { textoPlazo } from "./modalidades-sin-stock-validacion"
import type { PedidoItemDto } from "./pedidos-repo"

/**
 * Espejo de `SnapshotVentaSinStock` del Shop (`apps/clientes/src/lib/venta-sin-stock.ts`): las apps
 * no comparten código. Es lo que el Shop congeló en `order_items.venta_sin_stock`.
 */
export interface VentaSinStockLinea {
  modalidadId: string
  nombre: string
  texto: string
  plazoDias: number | null
  flujo: "en_linea" | "a_confirmar"
}

/** Defensivo: un jsonb de una fila vieja o rota da null. */
export function leerVentaSinStock(v: unknown): VentaSinStockLinea | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.modalidadId !== "string" || typeof o.nombre !== "string" || typeof o.texto !== "string") return null
  if (o.flujo !== "en_linea" && o.flujo !== "a_confirmar") return null
  if (o.plazoDias !== null && typeof o.plazoDias !== "number") return null
  return { modalidadId: o.modalidadId, nombre: o.nombre, texto: o.texto, plazoDias: o.plazoDias, flujo: o.flujo }
}

export function textoLineaAPedido(v: VentaSinStockLinea): string {
  return `A pedido · ${v.nombre} · ${textoPlazo(v.plazoDias)}`
}

/** Líneas con menos stock que lo pedido, sin las que se vendieron a pedido a propósito. */
export function lineasFaltaStock(items: PedidoItemDto[]): PedidoItemDto[] {
  return items.filter((i) => !i.ventaSinStock && i.stockActual !== null && i.stockActual < i.qty)
}

export function tituloAPedido(n: number): string {
  return n === 1 ? "1 producto a pedido" : `${n} productos a pedido`
}
