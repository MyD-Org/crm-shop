// Formateo y etiquetas de los pedidos del Shop para la lista y el detalle del CRM.
//
// Módulo PURO (sin React, sin fetch): lo usan componentes cliente que se renderizan primero en
// el servidor, así que TODO lo que dependa de la zona horaria sale de `fmtFechaPedido`, que fija
// `timeZone: "America/Argentina/Buenos_Aires"`. Un `toLocale*` sin zona da una hora en el
// server (UTC) y otra en el navegador (-03) y React lo marca como hydration mismatch.

import type { BadgeTone } from "@myd-org/ui"
import type { PagoRevision } from "@/lib/pedidos-repo"
import type { EstadoPedido } from "@/lib/pedidos-transiciones"
import { fmtMonto } from "../comprobantes/format"

/** 123456.7 → "$ 123.456,70". Reusa el formateador de moneda del admin (comprobantes). */
export function fmtMoneda(valor: number): string {
  if (!Number.isFinite(valor)) return "—"
  return fmtMonto(String(valor))
}

// No se reusa `fmtFechaHora` de comprobantes: con `hour: "2-digit"` a secas, es-AR sale en 12 h
// ("11:30 p. m.") y el espacio de "p. m." es U+202F o U+0020 según la versión de ICU, o sea
// que Node y el navegador pueden no coincidir (el hydration mismatch que ya sufrió el inbox).
// Acá: reloj de 24 h y el texto se arma a mano desde las partes, sin separadores de Intl.
const FECHA_HORA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
})

/** ISO → "21/09/2026, 23:30" hora Argentina. `null`/inválido → "—". */
export function fmtFechaPedido(iso: string | null): string {
  if (!iso) return "—"
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return "—"
  const parte: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const { type, value } of FECHA_HORA.formatToParts(fecha)) parte[type] = value
  return `${parte.day}/${parte.month}/${parte.year}, ${parte.hour}:${parte.minute}`
}

const CANTIDAD = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 })

/** Cantidad de un ítem (`numeric(14,3)`): 3 → "3", 1.5 → "1,5". */
export function fmtCantidad(qty: number): string {
  if (!Number.isFinite(qty)) return "—"
  return CANTIDAD.format(qty)
}

const TONO_ESTADO: Record<EstadoPedido, BadgeTone> = {
  pendiente: "warning",
  confirmado: "info",
  preparacion: "info",
  en_camino: "info",
  entregado: "success",
  cancelado: "danger",
}

export function tonoEstado(estado: EstadoPedido): BadgeTone {
  return TONO_ESTADO[estado]
}

/** Etiqueta de un mapa conocido; un valor que el CRM no conoce se muestra crudo (no se esconde). */
function etiqueta(mapa: Record<string, string>, valor: string): string {
  return Object.hasOwn(mapa, valor) ? mapa[valor] : valor
}

const ENTREGA_LABEL: Record<string, string> = {
  retiro: "Retiro",
  envio: "Envío",
}

export function entregaLabel(tipo: string): string {
  return etiqueta(ENTREGA_LABEL, tipo)
}

// Mismas etiquetas que ve el cliente en el Shop (`PAGO_LABEL` de apps/clientes). Se duplican
// porque las dos apps no comparten código.
const PAGO_METODO_LABEL: Record<string, string> = {
  a_coordinar: "A coordinar con un asesor",
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo en el local",
  cuenta_corriente: "Cuenta corriente",
  mercadopago: "Tarjeta o Mercado Pago",
}

export function pagoMetodoLabel(metodo: string): string {
  return etiqueta(PAGO_METODO_LABEL, metodo)
}

const PAGO_ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pago pendiente",
  pagado: "Pagado",
  fallido: "Pago rechazado",
}

export function pagoEstadoLabel(estado: string): string {
  return etiqueta(PAGO_ESTADO_LABEL, estado)
}

const CONDICION_IVA_LABEL: Record<string, string> = {
  consumidor_final: "Consumidor final",
  monotributo: "Monotributo",
  responsable_inscripto: "Responsable inscripto",
  exento: "Exento",
}

export function condicionIvaLabel(condicion: string | null): string {
  if (!condicion) return "—"
  return etiqueta(CONDICION_IVA_LABEL, condicion)
}

/**
 * "por Ana Pérez el 21/09/2026, 23:30". Sin nombre (p. ej. un cambio viejo sin actor) queda
 * "el …"; sin fecha el pedido nunca cambió de estado y no hay nada que mostrar.
 */
export function textoUltimoCambio(nombre: string | null, iso: string | null): string | null {
  if (!iso) return null
  const fecha = fmtFechaPedido(iso)
  const quien = nombre?.trim()
  return quien ? `por ${quien} el ${fecha}` : `el ${fecha}`
}

/** Etiqueta y explicación del pago a revisar. Mismo texto en el listado y en el detalle. */
export const PAGO_REVISION_INFO: Record<PagoRevision, { label: string; detalle: string }> = {
  cobro_duplicado: {
    label: "Cobro duplicado",
    detalle: "Este pedido se cobró más de una vez. Revise los pagos en Mercado Pago y devuelva el excedente.",
  },
  pagado_cancelado: {
    label: "Pagado y cancelado",
    detalle: "Se aprobó un pago de este pedido cancelado. Devuelva el pago en Mercado Pago o reactive el pedido.",
  },
}
