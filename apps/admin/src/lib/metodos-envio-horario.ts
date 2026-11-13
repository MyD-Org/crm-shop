// «Horario de entrega» y «Feriados» del método de envío (change `envio-rapido`). Ambos viven en
// `public.metodos_envio.config` (jsonb); sin migración:
//  - `config.horarioEntrega`: texto libre corto que el Shop muestra como «Llega hoy antes de las 21 hs».
//  - `config.feriados`: fechas "YYYY-MM-DD" en las que no se entrega (día no operativo).
// Módulo puro.

export const MAX_HORARIO_ENTREGA = 40
export const CLAVE_HORARIO_ENTREGA = "horarioEntrega"
export const MAX_FERIADOS = 60
export const CLAVE_FERIADOS = "feriados"

/** Texto normalizado del horario (recortado y con espacios simples) o null si supera el máximo o no es texto. */
export function normalizarHorarioEntrega(v: unknown): string | null {
  if (v === undefined || v === null) return ""
  if (typeof v !== "string") return null
  const t = v.replace(/\s+/g, " ").trim()
  return t.length <= MAX_HORARIO_ENTREGA ? t : null
}

/** ¿Es "YYYY-MM-DD" y una fecha real del calendario (no el 31/02)? */
export function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split("-").map(Number)
  if (y < 2000 || y > 2100) return false
  const f = new Date(Date.UTC(y, m - 1, d))
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

const ordenadasSinRepetir = (fechas: string[]) => [...new Set(fechas)].sort()

/**
 * Lista de feriados validada: ausente = []. null si no es una lista, tiene una fecha inválida o más de 60.
 * Devuelve las fechas ordenadas y sin duplicados.
 */
export function normalizarFeriados(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) return null
  const limpias = v.map((f) => (typeof f === "string" ? f.trim() : f))
  if (!limpias.every(esFechaIso)) return null
  const lista = ordenadasSinRepetir(limpias as string[])
  return lista.length <= MAX_FERIADOS ? lista : null
}

/** Lee `config.horarioEntrega` tolerando cualquier forma de config ("" = sin horario). */
export function horarioDeConfig(config: unknown): string {
  if (typeof config !== "object" || config === null) return ""
  const v = (config as Record<string, unknown>)[CLAVE_HORARIO_ENTREGA]
  return typeof v === "string" ? (normalizarHorarioEntrega(v) ?? "") : ""
}

/** Lee `config.feriados` tolerando cualquier forma: se descartan las entradas inválidas; ordenadas y sin repetir. */
export function feriadosDeConfig(config: unknown): string[] {
  if (typeof config !== "object" || config === null) return []
  const v = (config as Record<string, unknown>)[CLAVE_FERIADOS]
  if (!Array.isArray(v)) return []
  return ordenadasSinRepetir(v.filter(esFechaIso)).slice(0, MAX_FERIADOS)
}

/**
 * Config con el horario (y los feriados, si se pasan) aplicado, conservando el resto de las claves: con valor
 * lo fija; vacío, quita la clave. `feriados` ausente deja los que ya había.
 */
export function configConHorario(actual: unknown, horario: string, feriados?: string[]): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof actual === "object" && actual !== null && !Array.isArray(actual) ? { ...(actual as Record<string, unknown>) } : {}
  if (horario) base[CLAVE_HORARIO_ENTREGA] = horario
  else delete base[CLAVE_HORARIO_ENTREGA]
  if (feriados !== undefined) {
    if (feriados.length > 0) base[CLAVE_FERIADOS] = feriados
    else delete base[CLAVE_FERIADOS]
  }
  return base
}
