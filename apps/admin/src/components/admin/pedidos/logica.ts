// Lógica PURA de la sección Pedidos (sin React, sin fetch, sin next): armado de la query de
// la lista, opciones de los Select, validación del motivo de cancelación e interpretación de
// la respuesta del PATCH. Vive aparte de los componentes porque esta app no tiene jsdom: lo
// que se puede equivocar se prueba acá, y los componentes quedan como cableado.

import type { Cola } from "@/lib/pedidos-repo"
import {
  ESTADOS_PEDIDO,
  ESTADO_PEDIDO_LABEL,
  MOTIVO_MAX,
  MOTIVO_MIN,
  avisoCancelarConDevolucion,
  motivoNoCancelable,
  transicionesDesde,
  type EntregaTipo,
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

/** Mismo patrón que `FILTRO_TODOS`, para los Select de entrega y pago. */
export const FILTRO_ENTREGA_TODOS = "todos"
export const FILTRO_PAGO_TODOS = "todos"
export type FiltroEntrega = EntregaTipo | typeof FILTRO_ENTREGA_TODOS
export type FiltroPago = "pagado" | "pendiente" | typeof FILTRO_PAGO_TODOS

export function opcionesDeFiltroEntrega(): OpcionSelect[] {
  return [
    { value: FILTRO_ENTREGA_TODOS, label: "Envío y retiro" },
    { value: "envio", label: "Envío" },
    { value: "retiro", label: "Retiro en local" },
  ]
}

export function opcionesDeFiltroPago(): OpcionSelect[] {
  return [
    { value: FILTRO_PAGO_TODOS, label: "Pagados y pendientes" },
    { value: "pagado", label: "Pagados" },
    { value: "pendiente", label: "Pago pendiente" },
  ]
}

/** Valor del filtro "todas las sucursales" (mismo patrón que `FILTRO_TODOS`). */
export const FILTRO_SUCURSAL_TODAS = "todas"

export function opcionesDeFiltroSucursal(sucursales: { slug: string; nombre: string }[]): OpcionSelect[] {
  return [
    { value: FILTRO_SUCURSAL_TODAS, label: "Todas las sucursales" },
    ...sucursales.map((s) => ({ value: s.slug, label: s.nombre })),
  ]
}

/** Las colas de "Para atender", en el orden en que se muestran. Severidad = color de la barrita. */
export const COLAS_INFO: Record<Cola, { label: string; severidad: "amber" | "danger" | "info" }> = {
  sin_confirmar: { label: "Sin confirmar", severidad: "amber" },
  pago: { label: "Pago a revisar", severidad: "danger" },
  datos: { label: "Revisar datos", severidad: "amber" },
  sin_factura: { label: "Entregados sin factura", severidad: "info" },
  // El umbral de horas es de las reglas de venta: la pantalla lo agrega al rótulo.
  sin_contactar: { label: "Sin contactar", severidad: "danger" },
}

export const ORDEN_COLAS: Cola[] = ["sin_confirmar", "sin_contactar", "pago", "datos", "sin_factura"]

/** Atajos del diálogo de cancelación. "Sin respuesta" es el motivo típico de la cola "Sin contactar". */
export const MOTIVOS_FRECUENTES = ["Sin respuesta del cliente"] as const

/** Misma regla que la cola `sin_factura` del servidor: ENTREGADO y sin factura vinculada. */
export function esSinFactura(p: { estado: EstadoPedido; facturado: boolean }): boolean {
  return p.estado === "entregado" && !p.facturado
}

/**
 * Destinos que la UI OFRECE desde un estado, según el tipo de entrega del pedido: los de la
 * tabla de transiciones, nada más. Es comodidad, no seguridad: el que valida es el PATCH.
 */
export function opcionesDeDestino(
  estado: EstadoPedido,
  entregaTipo: EntregaTipo,
  puedeCancelar = true,
): OpcionSelect[] {
  return transicionesDesde(estado, entregaTipo)
    .filter((destino) => puedeCancelar || destino !== "cancelado")
    .map((destino) => ({
    value: destino,
    label: ESTADO_PEDIDO_LABEL[destino],
  }))
}

/**
 * ¿Se ofrece "Cancelar pedido"? Espeja las guardas del servidor con lo que la pantalla ya sabe
 * (pago, factura, historial). El intento de pago online pendiente no viaja al cliente: ese caso
 * lo rechaza el PATCH (422) y se muestra su mensaje. Comodidad, no seguridad.
 */
export function ofreceCancelar(p: {
  pagoEstado: string
  facturado: boolean
  /** Eventos del historial (sólo en el detalle); en la lista no viajan. */
  historial?: { tipo: string; detalle: Record<string, unknown> }[]
}): boolean {
  const estuvoEntregado = (p.historial ?? []).some((e) => e.tipo === "estado" && e.detalle.hacia === "entregado")
  return (
    motivoNoCancelable({
      pagoEstado: p.pagoEstado,
      facturado: p.facturado,
      intentoPagoPendiente: false,
      estuvoEntregado,
    }) === null
  )
}

/** Aviso del diálogo "Cancelar con devolución" según lo que ya sabe la pantalla del pedido. */
export function avisoDevolucion(p: { pagoEstado: string; facturado: boolean }): string {
  return avisoCancelarConDevolucion({ pagado: p.pagoEstado === "pagado", facturado: p.facturado })
}

export interface FiltrosLista {
  estado: FiltroEstado
  q?: string
  entrega?: FiltroEntrega
  pago?: FiltroPago
  cola?: Cola | null
  sucursal?: string
}

/**
 * Query string de `GET /api/admin/pedidos`. "todos" viaja explícito para `estado` (`estado=`
 * vacío es 400); `entrega`/`pago`/`cola`/`sucursal` en cambio se OMITEN cuando son "todos" o no vienen,
 * porque el servidor los toma como "sin filtro" con su sola ausencia (ver route.ts).
 */
export function queryDeLista(
  input: FiltrosLista & { start: number; limit: number; vista?: "tablero" },
): string {
  const params = new URLSearchParams({ estado: input.estado })
  const q = input.q?.trim()
  if (q) params.set("q", q)
  if (input.entrega && input.entrega !== FILTRO_ENTREGA_TODOS) params.set("entrega", input.entrega)
  if (input.pago && input.pago !== FILTRO_PAGO_TODOS) params.set("pago", input.pago)
  if (input.cola) params.set("cola", input.cola)
  if (input.sucursal && input.sucursal !== FILTRO_SUCURSAL_TODAS) params.set("sucursal", input.sucursal)
  if (input.vista) {
    params.set("vista", input.vista)
  } else {
    params.set("start", String(Math.max(0, Math.trunc(input.start))))
    params.set("limit", String(input.limit))
  }
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

// ───────────────────────── Camino feliz: Stepper y botón principal ─────────────────────────

/** Pasos del "camino feliz" que muestra el Stepper del detalle, según el tipo de entrega: un
 *  retiro no tiene parada "en_camino". `cancelado` no es un paso: se muestra aparte. */
export function pasosPedido(entregaTipo: EntregaTipo): EstadoPedido[] {
  const base: EstadoPedido[] = ["pendiente", "confirmado", "preparacion", "en_camino", "entregado"]
  return entregaTipo === "retiro" ? base.filter((e) => e !== "en_camino") : base
}

/**
 * El destino "de una sola flecha hacia adelante" desde `estado`, según el camino feliz de
 * `entregaTipo`. `null` si no hay siguiente (ya está entregado o el pedido está cancelado): ahí
 * sólo queda "Otro estado". No ofrece retrocesos ni cancelar: eso es `opcionesDeDestino`.
 */
export function siguientePaso(estado: EstadoPedido, entregaTipo: EntregaTipo): EstadoPedido | null {
  const pasos = pasosPedido(entregaTipo)
  const idx = pasos.indexOf(estado)
  if (idx === -1 || idx === pasos.length - 1) return null
  return pasos[idx + 1]
}

/** Texto del botón primario para pasar al `siguiente` paso. "Entregado" cambia de verbo en retiro. */
export function verboSiguientePaso(siguiente: EstadoPedido, entregaTipo: EntregaTipo): string {
  if (siguiente === "confirmado") return "Confirmar pedido"
  if (siguiente === "preparacion") return "Pasar a preparación"
  if (siguiente === "en_camino") return "Marcar en camino"
  if (siguiente === "entregado") return entregaTipo === "retiro" ? "Marcar como retirado" : "Marcar como entregado"
  return ESTADO_PEDIDO_LABEL[siguiente]
}

/** Destinos para el Select "Otro estado": los que ofrece la tabla de transiciones, MENOS el que
 *  ya se ofrece como botón primario (`siguientePaso`). Cancelar sigue apareciendo acá. */
export function opcionesOtroEstado(
  estado: EstadoPedido,
  entregaTipo: EntregaTipo,
  puedeCancelar = true,
): OpcionSelect[] {
  const siguiente = siguientePaso(estado, entregaTipo)
  return opcionesDeDestino(estado, entregaTipo, puedeCancelar)
    .filter((o) => o.value !== siguiente)
    .map((o) => (o.value === "cancelado" ? { ...o, label: "Cancelar pedido" } : o))
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

export type ResultadoFactura<T> =
  | { tipo: "ok"; valor: T }
  | { tipo: "conflicto"; mensaje: string }
  | { tipo: "error"; mensaje: string }

/** 5xx que la ruta de factura redacta para mostrar: Alegra falló (502) o nos frena (503). */
const FACTURA_5XX_CON_MENSAJE = new Set([502, 503])

/**
 * Respuesta de `/api/admin/pedidos/[id]/factura` (GET buscar, POST vincular, DELETE
 * desvincular). Como `interpretarRespuestaCambio`, pero 502/503 también traen un mensaje
 * pensado para el operador ("Alegra no respondió bien…"). `esValido` chequea la forma del 2xx.
 */
export function interpretarRespuestaFactura<T>(
  status: number | null,
  body: unknown,
  esValido: (body: unknown) => boolean,
): ResultadoFactura<T> {
  if (status !== null && status >= 200 && status < 300) {
    if (body !== null && typeof body === "object" && esValido(body)) return { tipo: "ok", valor: body as T }
    return { tipo: "error", mensaje: MENSAJE_ERROR_GENERICO }
  }
  if (status === 409) return { tipo: "conflicto", mensaje: errorDelServidor(body) ?? MENSAJE_ERROR_GENERICO }
  if (status !== null && ((status >= 400 && status < 500) || FACTURA_5XX_CON_MENSAJE.has(status))) {
    return { tipo: "error", mensaje: errorDelServidor(body) ?? MENSAJE_ERROR_GENERICO }
  }
  return { tipo: "error", mensaje: MENSAJE_ERROR_GENERICO }
}

/** `avisoFactura` de POST vincular y de POST reenviar: cómo salió el mail "Su factura". */
export interface AvisoFacturaDto {
  resultado: "enviado" | "sin_email" | "sin_pdf" | "fallo"
  /** Email del cliente enmascarado por el servidor (`c***@cliente.example`). */
  destino: string | null
}

const RESULTADOS_AVISO = new Set(["enviado", "sin_email", "sin_pdf", "fallo"])

/**
 * Separa `avisoFactura` del detalle del pedido que devuelve POST vincular, para no guardarlo
 * en el estado del pedido. Un `avisoFactura` con otra forma se ignora (null).
 */
export function separarAvisoFactura<T extends object>(body: T): { detalle: T; aviso: AvisoFacturaDto | null } {
  const { avisoFactura, ...detalle } = body as T & { avisoFactura?: unknown }
  return { detalle: detalle as T, aviso: leerAvisoFactura(avisoFactura) }
}

export function leerAvisoFactura(v: unknown): AvisoFacturaDto | null {
  if (v === null || typeof v !== "object") return null
  const { resultado, destino } = v as Record<string, unknown>
  if (typeof resultado !== "string" || !RESULTADOS_AVISO.has(resultado)) return null
  return { resultado: resultado as AvisoFacturaDto["resultado"], destino: typeof destino === "string" ? destino : null }
}

/** Texto breve para el operador según cómo salió el mail. */
export function mensajeAvisoFactura(aviso: AvisoFacturaDto): { texto: string; ok: boolean } {
  if (aviso.resultado === "enviado") {
    return { texto: aviso.destino ? `Enviamos la factura a ${aviso.destino}.` : "Enviamos la factura al cliente.", ok: true }
  }
  if (aviso.resultado === "sin_email") {
    return { texto: "El pedido no tiene un email válido: la factura no se envió por mail.", ok: false }
  }
  if (aviso.resultado === "sin_pdf") {
    return { texto: "No se pudo obtener el PDF de la factura en Alegra: no se envió por mail.", ok: false }
  }
  return { texto: "No se pudo enviar la factura por mail.", ok: false }
}
