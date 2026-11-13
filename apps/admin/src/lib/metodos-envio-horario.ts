// «Horario de entrega» del método de envío (change `envio-rapido`). Texto libre corto que el Shop muestra
// como «Llega hoy antes de las 21 hs». Vive en `public.metodos_envio.config` (jsonb) como
// `config.horarioEntrega`; sin migración. Módulo puro.

export const MAX_HORARIO_ENTREGA = 40
export const CLAVE_HORARIO_ENTREGA = "horarioEntrega"

/** Texto normalizado del horario (recortado y con espacios simples) o null si supera el máximo o no es texto. */
export function normalizarHorarioEntrega(v: unknown): string | null {
  if (v === undefined || v === null) return ""
  if (typeof v !== "string") return null
  const t = v.replace(/\s+/g, " ").trim()
  return t.length <= MAX_HORARIO_ENTREGA ? t : null
}

/** Lee `config.horarioEntrega` tolerando cualquier forma de config ("" = sin horario). */
export function horarioDeConfig(config: unknown): string {
  if (typeof config !== "object" || config === null) return ""
  const v = (config as Record<string, unknown>)[CLAVE_HORARIO_ENTREGA]
  return typeof v === "string" ? (normalizarHorarioEntrega(v) ?? "") : ""
}

/**
 * Config con el horario aplicado, conservando el resto de las claves: con horario lo fija; vacío, quita la
 * clave (sin horario).
 */
export function configConHorario(actual: unknown, horario: string): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof actual === "object" && actual !== null && !Array.isArray(actual) ? { ...(actual as Record<string, unknown>) } : {}
  if (horario) base[CLAVE_HORARIO_ENTREGA] = horario
  else delete base[CLAVE_HORARIO_ENTREGA]
  return base
}
