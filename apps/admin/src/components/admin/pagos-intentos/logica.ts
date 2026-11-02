// Lógica pura de la pestaña "Intentos de pago" de Pedidos (sin React ni fetch): armado de queries,
// etiquetas y tonos. La clasificación de la causa NO se calcula acá: la hace el servidor
// (`CLASE_INTENTO_SQL`) y esta capa sólo la traduce a texto.

import type { BadgeTone } from "@myd-org/ui"
import type { ClaseIntento, IntentoListaDto, IntentoPedidoDto } from "@/lib/pagos-intentos-repo"

export const FILTRO_TODOS = "todos"
export const FILTRO_CLASE_TODAS = "todas"
export const FILTRO_CUENTA_TODAS = "todas"
export const DIAS_DEFAULT = 7
export const SIN_DETALLE = "Sin detalle registrado"

export const ETIQUETA_CLASE: Readonly<Record<ClaseIntento, string>> = {
  aprobado: "Aprobado",
  rechazo_banco: "Rechazo del banco",
  error_proveedor: "Error del proveedor",
  credenciales: "Credenciales rechazadas",
  reserva_abandonada: "Reserva abandonada",
  pendiente: "En curso",
}

export const TONO_CLASE: Readonly<Record<ClaseIntento, BadgeTone>> = {
  aprobado: "success",
  rechazo_banco: "warning",
  error_proveedor: "danger",
  credenciales: "danger",
  reserva_abandonada: "neutral",
  pendiente: "info",
}

export const OPCIONES_VENTANA = [
  { value: "1", label: "Último día" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
]

export const OPCIONES_PROVEEDOR = [
  { value: FILTRO_TODOS, label: "Todos los medios" },
  { value: "mercadopago", label: "Mercado Pago" },
  { value: "payway", label: "Payway" },
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
]

export const OPCIONES_CLASE = [
  { value: FILTRO_CLASE_TODAS, label: "Todos los estados" },
  { value: "fallos", label: "Todos los fallos" },
  { value: "aprobado", label: ETIQUETA_CLASE.aprobado },
  { value: "rechazo_banco", label: ETIQUETA_CLASE.rechazo_banco },
  { value: "error_proveedor", label: ETIQUETA_CLASE.error_proveedor },
  { value: "credenciales", label: ETIQUETA_CLASE.credenciales },
  { value: "reserva_abandonada", label: ETIQUETA_CLASE.reserva_abandonada },
  { value: "pendiente", label: ETIQUETA_CLASE.pendiente },
]

const NOMBRE_PROVEEDOR: Readonly<Record<string, string>> = {
  mercadopago: "Mercado Pago",
  payway: "Payway",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
}

export function nombreProveedor(proveedor: string): string {
  return NOMBRE_PROVEEDOR[proveedor] ?? proveedor
}

/** Slug de cuenta (sucursal) → nombre de la sucursal si se conoce; "sin_cuenta" → "Sin cuenta". */
export function nombreCuenta(slug: string | null, nombres: ReadonlyMap<string, string> = new Map()): string {
  if (!slug || slug === "sin_cuenta") return "Sin cuenta"
  return nombres.get(slug) ?? slug
}

/** Opciones del filtro de cuenta: "Todas las cuentas" + las cuentas que aparecen en el resumen. */
export function opcionesDeCuenta(
  cuentas: readonly string[],
  nombres: ReadonlyMap<string, string> = new Map(),
): { value: string; label: string }[] {
  const unicas = [...new Set(cuentas)].sort()
  return [
    { value: FILTRO_CUENTA_TODAS, label: "Todas las cuentas" },
    ...unicas.map((c) => ({ value: c, label: nombreCuenta(c, nombres) })),
  ]
}

/** 0.25 → "25 %"; 0.1234 → "12,3 %"; null (sin intentos resueltos) → "—". Nunca "NaN". */
export function fmtTasa(tasa: number | null): string {
  if (tasa === null || !Number.isFinite(tasa)) return "—"
  const pct = Math.round(tasa * 1000) / 10
  return `${String(pct).replace(".", ",")} %`
}

export interface FiltrosIntentos {
  dias?: number
  proveedor?: string
  cuenta?: string
  clase?: string
  q?: string
}

export function queryIntentos(input: FiltrosIntentos & { start: number; limit: number }): string {
  const params = new URLSearchParams({ dias: String(input.dias ?? DIAS_DEFAULT) })
  if (input.proveedor && input.proveedor !== FILTRO_TODOS) params.set("proveedor", input.proveedor)
  if (input.cuenta && input.cuenta !== FILTRO_CUENTA_TODAS) params.set("cuenta", input.cuenta)
  if (input.clase && input.clase !== FILTRO_CLASE_TODAS) params.set("clase", input.clase)
  const q = input.q?.trim()
  if (q) params.set("q", q)
  params.set("start", String(Math.max(0, Math.trunc(input.start))))
  params.set("limit", String(input.limit))
  return params.toString()
}

export function queryResumen(dias: number | undefined): string {
  return new URLSearchParams({ dias: String(dias ?? DIAS_DEFAULT) }).toString()
}

/** Rótulo del estado de una fila de la lista: la clase, o "Transferencia – pendiente/acreditada". */
export function etiquetaFila(f: Pick<IntentoListaDto, "clase" | "estado" | "proveedor">): string {
  if (f.clase === "offline") {
    return `${nombreProveedor(f.proveedor)} – ${f.estado === "pagado" ? "acreditada" : "pendiente"}`
  }
  return ETIQUETA_CLASE[f.clase]
}

export function tonoFila(f: Pick<IntentoListaDto, "clase" | "estado">): BadgeTone {
  if (f.clase === "offline") return f.estado === "pagado" ? "success" : "info"
  return TONO_CLASE[f.clase]
}

/**
 * Motivo para mostrar: el error del proveedor (con su HTTP) si lo hay; si no, el detalle del intento;
 * si no, "Sin detalle registrado". Un aprobado no tiene motivo. `null` = nada que mostrar.
 */
export function motivoIntento(
  f: Pick<IntentoPedidoDto, "clase" | "estado" | "detalle" | "errorProveedor" | "errorStatus">,
): string | null {
  if (f.clase === "aprobado") return null
  if (f.errorProveedor) {
    return f.errorStatus !== null ? `${f.errorProveedor} (HTTP ${f.errorStatus})` : f.errorProveedor
  }
  if (f.errorStatus !== null) return `Respuesta ${f.errorStatus} del proveedor`
  if (f.detalle) return f.detalle
  return f.clase === "pendiente" ? null : SIN_DETALLE
}
