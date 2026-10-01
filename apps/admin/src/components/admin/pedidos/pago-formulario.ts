// Lógica PURA del formulario "Registrar pago" del detalle de pedido (sin React, sin fetch): qué
// se precarga, cómo se describen los comprobantes y cómo se arma el cuerpo del POST. Vive aparte
// del componente porque esta app no tiene jsdom (ver `logica.ts`).

import type { ComprobantePedidoDto } from "@/lib/pedidos-repo"
import { fmtFechaDia, fmtMoneda } from "./format"

/** Valor del Select cuando no se asocia ningún comprobante (el Select no admite ""). */
export const SIN_COMPROBANTE = "ninguno"

export interface FormularioPago {
  monto: string
  /** "YYYY-MM-DD". */
  fecha: string
  referencia: string
  /** Id del comprobante, o `SIN_COMPROBANTE`. */
  comprobante: string
}

const DIA_AR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** "YYYY-MM-DD" del día en Argentina (la del negocio), no el de UTC. */
export function hoyArgentina(now: Date = new Date()): string {
  const partes = DIA_AR.formatToParts(now)
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? ""
  return `${v("year")}-${v("month")}-${v("day")}`
}

/**
 * Valores iniciales: si el pedido tiene un comprobante PENDIENTE (el más nuevo, la lista viene
 * del más nuevo al más viejo) se preselecciona y se precarga su monto y su fecha; si no, el total
 * del pedido y la fecha de hoy. Uno ya cargado no se preselecciona: ya tuvo su pago.
 */
export function formularioPagoInicial(
  pedido: { total: number },
  comprobantes: readonly ComprobantePedidoDto[],
  now: Date = new Date(),
): FormularioPago {
  const pendiente = comprobantes.find((c) => c.estado === "pending")
  return {
    monto: (pendiente ? pendiente.monto : pedido.total).toFixed(2),
    fecha: pendiente ? pendiente.fecha : hoyArgentina(now),
    referencia: "",
    comprobante: pendiente ? pendiente.id : SIN_COMPROBANTE,
  }
}

export function etiquetaComprobante(c: ComprobantePedidoDto): string {
  const estado = c.estado === "loaded" ? "Ya cargado" : "Por revisar"
  return `${fmtMoneda(c.monto)} · ${fmtFechaDia(c.fecha)} · ${estado}`
}

export function opcionesComprobante(comprobantes: readonly ComprobantePedidoDto[]): { value: string; label: string }[] {
  return [
    { value: SIN_COMPROBANTE, label: "Sin comprobante" },
    ...comprobantes.map((c) => ({ value: c.id, label: etiquetaComprobante(c) })),
  ]
}

/**
 * Cuerpo del POST. Una coma decimal ("1210,50") pasa a punto; cualquier otra forma (con
 * separador de miles) se manda tal cual y la rechaza el servidor: no se adivina el monto.
 */
export function cuerpoRegistrarPago(f: FormularioPago): {
  pagado: true
  monto: string
  fecha: string
  referencia?: string
  receiptId?: string
} {
  let monto = f.monto.trim()
  if (monto.includes(",") && !monto.includes(".")) monto = monto.replace(",", ".")
  const referencia = f.referencia.trim()
  return {
    pagado: true,
    monto,
    fecha: f.fecha.trim(),
    ...(referencia ? { referencia } : {}),
    ...(f.comprobante !== SIN_COMPROBANTE ? { receiptId: f.comprobante } : {}),
  }
}
