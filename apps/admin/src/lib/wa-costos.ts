// Costos de WhatsApp (conversaciones de servicio gratis vs. cobradas). Funciones puras de
// formato/estado compartidas por el panel "Uso del bot", el cartel del shell y el push del
// evento `wa_billing`. Los datos los calcula la ai-api; acá sólo se presentan.

export type WaLevel = "ok" | "warning" | "billing" | "unknown"

export interface WaCostsNumber {
  phone: string
  serviceVolume: number
  billedServiceVolume: number
  cost: number
  level: WaLevel
}

export interface WaCostsSummary {
  /** 'YYYY-MM' en UTC. */
  month: string
  limit: number
  numbers: WaCostsNumber[]
  errors: { phone?: string; message: string }[]
  lastRunAt: string | null
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** '2026-10' -> 'octubre de 2026 (UTC)'. El mes de Meta corre en UTC: se rotula para no confundir. */
export function monthLabelUtc(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  const nombre = m ? MESES[Number(m[2]) - 1] : undefined
  return m && nombre ? `${nombre} de ${m[1]} (UTC)` : month
}

/** '800' / '1000' -> '800 de 1.000'. Separador de miles fijo (no depende del ICU del runtime). */
export function fmtMiles(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

export function volumeText(volume: number, limit: number): string {
  return `${fmtMiles(volume)} de ${fmtMiles(limit)}`
}

/** Porcentaje del tope gratis consumido, acotado a 0-100 para la barra. */
export function usagePercent(volume: number, limit: number): number {
  if (!(limit > 0) || !(volume > 0)) return 0
  return Math.min(100, Math.round((volume / limit) * 100))
}

export function levelText(level: WaLevel): string {
  if (level === "billing") return "WhatsApp ya cobra las respuestas"
  if (level === "warning") return "Cerca del tope gratis"
  if (level === "ok") return "Dentro del tope gratis"
  return "No se pudo consultar"
}

/**
 * Sin números y con errores no hay dato: la UI debe decir "No se pudo consultar", nunca 0.
 * Un número ausente de `numbers` es consumo cero, pero sólo cuando no hubo errores.
 */
export function waCostsStatus(s: WaCostsSummary): "sin-datos" | "vacio" | "datos" {
  if (s.numbers.length > 0) return "datos"
  return s.errors.length > 0 ? "sin-datos" : "vacio"
}

/** Cantidad de números que merecen el cartel (warning o billing). */
export function numbersToWarn(s: WaCostsSummary): WaCostsNumber[] {
  return s.numbers.filter((n) => n.level === "warning" || n.level === "billing")
}

export function bannerText(s: WaCostsSummary): string | null {
  const alerta = numbersToWarn(s)
  if (alerta.length === 0) return null
  const cobran = alerta.filter((n) => n.level === "billing")
  if (cobran.length > 0) {
    return cobran.length === 1
      ? `WhatsApp empezó a cobrar las respuestas de ${cobran[0].phone} este mes.`
      : `WhatsApp empezó a cobrar las respuestas de ${cobran.length} números este mes.`
  }
  const n = alerta[0]
  return alerta.length === 1
    ? `Mensajes de WhatsApp: ${n.phone} llegó a ${volumeText(n.serviceVolume, s.limit)} gratis de este mes.`
    : `Mensajes de WhatsApp: ${alerta.length} números están cerca del tope gratis de este mes.`
}

export type WaBillingKind = "free_80" | "service_billed"

export function isWaBillingKind(v: unknown): v is WaBillingKind {
  return v === "free_80" || v === "service_billed"
}

/** Texto del push (usted). */
export function billingPushText(kind: WaBillingKind, phone: string, volume: number, limit: number) {
  if (kind === "free_80") {
    return {
      title: "Mensajes de WhatsApp",
      body: `Mensajes de WhatsApp: ${phone} llegó a ${fmtMiles(volume)} de ${fmtMiles(limit)} gratis de este mes.`,
    }
  }
  return {
    title: "WhatsApp empezó a cobrar",
    body: `WhatsApp empezó a cobrar las respuestas de ${phone} este mes.`,
  }
}
