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

/** Tipo de entrega del pedido (columna `entrega_tipo` de `shop.orders`). */
export type EntregaTipo = "retiro" | "envio"

/**
 * Tabla FINAL de transiciones (decisión del usuario), para un pedido de ENVÍO. Además del
 * camino feliz incluye las "correcciones" hacia atrás, porque el operador se equivoca y tiene
 * que poder deshacer. Dos reglas duras: un pedido ENTREGADO no se cancela, y CANCELADO es
 * terminal (no se reactiva). Las entregas directas (confirmado/preparacion → entregado) valen
 * para retiro y para envío por igual.
 *
 * Un pedido de RETIRO usa esta MISMA tabla, salvo que `en_camino` no existe como DESTINO (un
 * retiro no "viaja"): se lo saca de `preparacion` (que va directo a `entregado`) y de las
 * correcciones de `entregado`. Si un pedido de retiro ya está en `en_camino` (dato viejo, de
 * antes de esta regla), puede salir de ahí a sus destinos normales igual que uno de envío —
 * `en_camino` sigue siendo un ORIGEN válido para los dos tipos; sólo deja de ofrecerse como
 * destino para retiro. Ver `transicionesDesde` / `puedeTransicionar`.
 */
const TRANSICIONES_ENVIO: Record<EstadoPedido, readonly EstadoPedido[]> = {
  pendiente: ["confirmado", "cancelado"],
  confirmado: ["preparacion", "entregado", "pendiente", "cancelado"],
  preparacion: ["en_camino", "entregado", "confirmado", "cancelado"],
  en_camino: ["entregado", "preparacion", "cancelado"],
  entregado: ["en_camino", "preparacion", "confirmado"],
  cancelado: [],
}

/** Tabla completa de ENVÍO: se sigue exponiendo para el test de contrato y por compatibilidad. */
export const TRANSICIONES = TRANSICIONES_ENVIO

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

/**
 * Destinos válidos desde `estado`, para un pedido con ese `entregaTipo`. En RETIRO se saca
 * `en_camino` de la lista de destinos (no existe esa parada); en ENVÍO no cambia nada. El
 * estado `en_camino` como ORIGEN se deja intacto en los dos casos: es el caso del dato viejo.
 */
export function transicionesDesde(estado: EstadoPedido, entregaTipo: EntregaTipo): readonly EstadoPedido[] {
  const base = TRANSICIONES_ENVIO[estado]
  if (entregaTipo === "retiro") return base.filter((destino) => destino !== "en_camino")
  return base
}

/** `false` también para el mismo estado: "cambiar" a lo que ya está no es una transición. */
export function puedeTransicionar(desde: EstadoPedido, hacia: EstadoPedido, entregaTipo: EntregaTipo): boolean {
  return transicionesDesde(desde, entregaTipo).includes(hacia)
}

/**
 * Texto del 422 para un par que la tabla no admite. Los dos casos con regla de negocio propia
 * tienen su mensaje; el resto usa el patrón genérico con las etiquetas visibles. No depende del
 * tipo de entrega: el mensaje es el mismo par de etiquetas, se rechace por la regla dura o
 * porque ese destino no existe para retiro.
 */
export function mensajeTransicionInvalida(desde: EstadoPedido, hacia: EstadoPedido): string {
  if (desde === "cancelado") return "El pedido está cancelado y no admite más cambios de estado."
  if (desde === "entregado" && hacia === "cancelado") return "Un pedido entregado no se puede cancelar."
  return `No es posible cambiar el pedido de «${ESTADO_PEDIDO_LABEL[desde]}» a «${ESTADO_PEDIDO_LABEL[hacia]}».`
}

/**
 * Por qué un pedido NO se puede cancelar aunque la tabla de transiciones lo permita. Lo decide
 * el servidor (`cambiarEstado`, dentro de la transacción); la UI usa `motivoNoCancelable` sólo
 * para no ofrecer la opción.
 *  - pagado: cobrado (online o registrado a mano); cancelar dejaría plata sin devolver.
 *  - facturado: tiene factura vinculada o una emisión en curso (`facturado_en` no nulo).
 *  - pago_en_curso: hay un intento de pago online pendiente (`shop.pago_intentos`).
 *  - entregado: estuvo entregado alguna vez (aunque se lo haya devuelto a otro estado).
 */
export type MotivoNoCancelable = "pagado" | "facturado" | "pago_en_curso" | "entregado"

export interface DatosCancelacion {
  pagoEstado: string
  /** `facturado_en` no nulo (factura real o reserva de emisión). */
  facturado: boolean
  intentoPagoPendiente: boolean
  estuvoEntregado: boolean
}

/** Todos los bloqueos que aplican, en orden de prioridad. Vacío = se puede cancelar. */
export function motivosNoCancelable(d: DatosCancelacion): MotivoNoCancelable[] {
  const motivos: MotivoNoCancelable[] = []
  if (d.pagoEstado === "pagado") motivos.push("pagado")
  if (d.facturado) motivos.push("facturado")
  if (d.intentoPagoPendiente) motivos.push("pago_en_curso")
  if (d.estuvoEntregado) motivos.push("entregado")
  return motivos
}

/** `null` = se puede cancelar. Si hay varios bloqueos, el de mayor prioridad. */
export function motivoNoCancelable(d: DatosCancelacion): MotivoNoCancelable | null {
  return motivosNoCancelable(d)[0] ?? null
}

export function mensajeNoCancelable(motivo: MotivoNoCancelable): string {
  switch (motivo) {
    case "pagado":
      return "No se puede cancelar un pedido pagado. Anule el pago o gestione la devolución antes de cancelarlo."
    case "facturado":
      return "No se puede cancelar un pedido facturado. Desvincule la factura antes de cancelarlo."
    case "pago_en_curso":
      return "No se puede cancelar un pedido con un pago de Mercado Pago en curso. Espere a que el pago se resuelva e inténtelo nuevamente."
    case "entregado":
      return "No se puede cancelar un pedido que ya fue entregado."
  }
}

/**
 * Ventana en la que un intento de pago online pendiente sigue "en curso". Es la misma
 * `VENTANA_PAGO_MS` del Shop (apps/clientes/src/lib/pedidos.ts): pasadas 24 h desde que se creó
 * el intento ya no se puede cobrar, así que un intento abandonado deja de bloquear la cancelación.
 */
export const VENTANA_PAGO_MS = 24 * 60 * 60_000

/**
 * Texto del aviso del diálogo "Cancelar con devolución" (sólo admin y superadmin): qué hay que
 * resolver FUERA del CRM antes de cancelar. Se combinan los que apliquen.
 */
export function avisoCancelarConDevolucion(p: { pagado: boolean; facturado: boolean }): string {
  const partes: string[] = []
  if (p.pagado) partes.push("Antes de cancelarlo, gestione la devolución en Mercado Pago.")
  if (p.facturado) partes.push("Antes de cancelarlo, emita la nota de crédito en Alegra.")
  return partes.join(" ")
}
