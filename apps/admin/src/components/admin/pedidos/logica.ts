// Lógica PURA de la sección Pedidos (sin React, sin fetch, sin next): armado de la query de
// la lista, opciones de los Select, validación del motivo de cancelación e interpretación de
// la respuesta del PATCH. Vive aparte de los componentes porque esta app no tiene jsdom: lo
// que se puede equivocar se prueba acá, y los componentes quedan como cableado.

import {
  ESTADOS_PEDIDO,
  ESTADO_PEDIDO_LABEL,
  MOTIVO_MAX,
  MOTIVO_MIN,
  transicionesDesde,
  type EstadoPedido,
} from "@/lib/pedidos-transiciones"

/** Valor del filtro "sin filtro". No puede ser "": el Select del design system no lo admite. */
export const FILTRO_TODOS = "todos"
export type FiltroEstado = EstadoPedido | typeof FILTRO_TODOS

export interface OpcionSelect {
  value: string
  label: string
}

export function opcionesDeFiltro(): OpcionSelect[] {
  return [
    { value: FILTRO_TODOS, label: "Todos" },
    ...ESTADOS_PEDIDO.map((estado) => ({ value: estado, label: ESTADO_PEDIDO_LABEL[estado] })),
  ]
}

/**
 * Destinos que la UI OFRECE desde un estado: los de la tabla de transiciones, nada más.
 * Es comodidad, no seguridad: el que valida es el PATCH.
 */
export function opcionesDeDestino(estado: EstadoPedido): OpcionSelect[] {
  return transicionesDesde(estado).map((destino) => ({
    value: destino,
    label: ESTADO_PEDIDO_LABEL[destino],
  }))
}

/** Query string de `GET /api/admin/pedidos`. "todos" viaja explícito: `estado=` vacío es 400. */
export function queryDeLista(input: { estado: FiltroEstado; start: number; limit: number }): string {
  const params = new URLSearchParams({
    estado: input.estado,
    start: String(Math.max(0, Math.trunc(input.start))),
    limit: String(input.limit),
  })
  return params.toString()
}

/** "26–40 de 40" para el paginador. `cantidad` = filas de la página actual. */
export function textoRango(start: number, cantidad: number, total: number): string {
  if (total === 0) return "0"
  if (cantidad === 0) return `0 de ${total}`
  return `${start + 1}–${start + cantidad} de ${total}`
}

/** Misma regla que el servidor: el largo se mide DESPUÉS del trim, entre MOTIVO_MIN y MOTIVO_MAX. */
export function motivoValido(texto: string): boolean {
  const largo = texto.trim().length
  return largo >= MOTIVO_MIN && largo <= MOTIVO_MAX
}

export const MENSAJE_ERROR_GENERICO = "No se pudo actualizar el pedido. Inténtelo nuevamente."

export type ResultadoCambio<T> =
  | { tipo: "ok"; pedido: T }
  /** 409: otro usuario lo cambió antes. La UI muestra el mensaje y recarga el pedido. */
  | { tipo: "conflicto"; mensaje: string }
  | { tipo: "error"; mensaje: string }

function errorDelServidor(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as { error?: unknown }).error
  return typeof error === "string" && error.trim() !== "" ? error : null
}

/**
 * Traduce la respuesta del PATCH a lo que tiene que hacer la UI. `status` en null = no hubo
 * respuesta (red caída). Los `{error}` de 4xx ya vienen redactados para mostrar tal cual; un
 * 5xx nunca se muestra crudo.
 */
export function interpretarRespuestaCambio<T extends { id: string; estado: string }>(
  status: number | null,
  body: unknown,
): ResultadoCambio<T> {
  if (status !== null && status >= 200 && status < 300) {
    const pedido = body as Partial<T> | null
    if (pedido && typeof pedido === "object" && typeof pedido.id === "string" && typeof pedido.estado === "string") {
      return { tipo: "ok", pedido: pedido as T }
    }
    return { tipo: "error", mensaje: MENSAJE_ERROR_GENERICO }
  }
  if (status === 409) {
    return { tipo: "conflicto", mensaje: errorDelServidor(body) ?? MENSAJE_ERROR_GENERICO }
  }
  if (status !== null && status >= 400 && status < 500) {
    return { tipo: "error", mensaje: errorDelServidor(body) ?? MENSAJE_ERROR_GENERICO }
  }
  return { tipo: "error", mensaje: MENSAJE_ERROR_GENERICO }
}
