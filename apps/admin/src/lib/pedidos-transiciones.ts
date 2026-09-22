// Máquina de estados de los pedidos del Shop, vista desde el CRM.
//
// Módulo PURO a propósito (sin db, sin next, sin env): lo importan la ruta PATCH —que es la
// que valida de verdad— y el componente cliente, que sólo lo usa para OFRECER las opciones
// válidas. Lo que decide es el servidor: la UI es comodidad, no seguridad.
//
// Los 6 estados son los mismos que `OrderEstado` del Shop y que el CHECK `orders_estado_check`
// de la base. Se duplican acá (en vez de importarlos de apps/clientes) porque las dos apps no
// comparten código; el test de contrato de integración es la red contra la deriva.

export const ESTADOS_PEDIDO = [
  "pendiente",
  "confirmado",
  "preparacion",
  "en_camino",
  "entregado",
  "cancelado",
] as const

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number]

/**
 * Tabla FINAL de transiciones (decisión del usuario). Además del camino feliz incluye las
 * "correcciones" hacia atrás, porque el operador se equivoca y tiene que poder deshacer.
 * Dos reglas duras: un pedido ENTREGADO no se cancela, y CANCELADO es terminal (no se reactiva).
 * Las entregas directas (confirmado/preparacion → entregado) valen para retiro y para envío:
 * no dependen de `entrega_tipo`.
 */
export const TRANSICIONES: Record<EstadoPedido, readonly EstadoPedido[]> = {
  pendiente: ["confirmado", "cancelado"],
  confirmado: ["preparacion", "entregado", "pendiente", "cancelado"],
  preparacion: ["en_camino", "entregado", "confirmado", "cancelado"],
  en_camino: ["entregado", "preparacion", "cancelado"],
  entregado: ["en_camino", "preparacion", "confirmado"],
  cancelado: [],
}

/** Las mismas etiquetas que ve el cliente en "Mis compras": un solo vocabulario. */
export const ESTADO_PEDIDO_LABEL: Record<EstadoPedido, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  preparacion: "En preparación",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
}

/** Largo del motivo de cancelación, medido DESPUÉS del trim. */
export const MOTIVO_MIN = 1
export const MOTIVO_MAX = 500

export function esEstadoPedido(v: unknown): v is EstadoPedido {
  return typeof v === "string" && (ESTADOS_PEDIDO as readonly string[]).includes(v)
}

export function transicionesDesde(estado: EstadoPedido): readonly EstadoPedido[] {
  return TRANSICIONES[estado]
}

/** `false` también para el mismo estado: "cambiar" a lo que ya está no es una transición. */
export function puedeTransicionar(desde: EstadoPedido, hacia: EstadoPedido): boolean {
  return TRANSICIONES[desde].includes(hacia)
}

/**
 * Texto del 422 para un par que la tabla no admite. Los dos casos con regla de negocio propia
 * tienen su mensaje; el resto usa el patrón genérico con las etiquetas visibles.
 */
export function mensajeTransicionInvalida(desde: EstadoPedido, hacia: EstadoPedido): string {
  if (desde === "cancelado") return "El pedido está cancelado y no admite más cambios de estado."
  if (desde === "entregado" && hacia === "cancelado") return "Un pedido entregado no se puede cancelar."
  return `No es posible cambiar el pedido de «${ESTADO_PEDIDO_LABEL[desde]}» a «${ESTADO_PEDIDO_LABEL[hacia]}».`
}
