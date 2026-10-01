import { isValidPaidOn, parseAmount } from "@/lib/receipt-validation"

// Validación pura del cuerpo de "Registrar pago" de un pedido offline (change
// `pago-transferencia-comprobante`, rebanada D). Reusa el monto y la fecha de los comprobantes
// (`parseAmount`, `isValidPaidOn`) para que las dos pantallas acepten lo mismo.

export const REFERENCIA_MAX = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const MSG_PAGO = {
  monto: "Ingrese un monto mayor a cero",
  fechaFaltante: "Indique la fecha del pago",
  fechaInvalida: "La fecha del pago no puede ser futura ni tener más de dos años.",
  referencia: `La referencia no puede superar los ${REFERENCIA_MAX} caracteres.`,
  comprobante: "El comprobante indicado no es válido.",
} as const

export interface PagoManualEntrada {
  monto?: unknown
  fecha?: unknown
  referencia?: unknown
  receiptId?: unknown
}

export type PagoManualCampo = "monto" | "fecha" | "referencia" | "receiptId"

export type PagoManualValidado =
  | { ok: true; monto: string; fecha: string; referencia: string | null; receiptId: string | null }
  | { ok: false; campo: PagoManualCampo; error: string }

const falla = (campo: PagoManualCampo, error: string): PagoManualValidado => ({ ok: false, campo, error })

export function validarPagoManual(entrada: PagoManualEntrada, now: Date): PagoManualValidado {
  const monto = parseAmount(entrada.monto)
  if (monto === null) return falla("monto", MSG_PAGO.monto)

  if (entrada.fecha === undefined || entrada.fecha === null || (typeof entrada.fecha === "string" && entrada.fecha.trim() === "")) {
    return falla("fecha", MSG_PAGO.fechaFaltante)
  }
  if (typeof entrada.fecha !== "string" || !isValidPaidOn(entrada.fecha.trim(), now)) {
    return falla("fecha", MSG_PAGO.fechaInvalida)
  }

  let referencia: string | null = null
  if (entrada.referencia !== undefined && entrada.referencia !== null) {
    if (typeof entrada.referencia !== "string") return falla("referencia", MSG_PAGO.referencia)
    const r = entrada.referencia.trim()
    if (r.length > REFERENCIA_MAX) return falla("referencia", MSG_PAGO.referencia)
    referencia = r === "" ? null : r
  }

  let receiptId: string | null = null
  if (entrada.receiptId !== undefined && entrada.receiptId !== null && entrada.receiptId !== "") {
    if (typeof entrada.receiptId !== "string" || !UUID_RE.test(entrada.receiptId)) return falla("receiptId", MSG_PAGO.comprobante)
    receiptId = entrada.receiptId
  }

  return { ok: true, monto, fecha: entrada.fecha.trim(), referencia, receiptId }
}
