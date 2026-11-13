/**
 * Fecha de entrega del método "Envío en el día" (change `envio-por-zona-con-tarifa`). Módulo PURO.
 *
 * Copia en el CRM de `apps/clientes/src/lib/entrega-fecha.ts` (no hay paquetes compartidos); las dos
 * ejecutan el MISMO fixture (`__fixtures__/envio-zona-casos.json`, sección `fechas`).
 *
 * Regla: se entrega el mismo día si el día LOCAL (America/Argentina/Buenos_Aires) es operativo y la
 * hora local es estrictamente anterior a `corte - margen`; si no, el siguiente día operativo.
 * Los días son ISO: 1 = lunes … 7 = domingo.
 */

export const TZ_ENVIO = "America/Argentina/Buenos_Aires"

export interface HorarioEnvio {
  /** Días operativos (ISO, 1 = lunes). */
  dias: number[]
  /** "HH:MM" en hora argentina. */
  horaCorte: string
  /** Minutos antes del corte en los que ya no se promete el mismo día. */
  margenMin: number
}

export interface FechaEntrega {
  /** "YYYY-MM-DD" (fecha civil argentina). */
  fecha: string
  mismoDia: boolean
}

interface PartesLocales {
  y: number
  m: number
  d: number
  minutos: number
}

const formato = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ_ENVIO,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function partesLocales(instante: Date): PartesLocales {
  const partes: Record<string, number> = {}
  for (const p of formato.formatToParts(instante)) {
    if (p.type !== "literal") partes[p.type] = Number(p.value)
  }
  return { y: partes.year, m: partes.month, d: partes.day, minutos: partes.hour * 60 + partes.minute }
}

/** Día ISO (1 = lunes … 7 = domingo) de una fecha civil. */
function diaIso(y: number, m: number, d: number): number {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = domingo
  return dow === 0 ? 7 : dow
}

function sumarDias(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const f = new Date(Date.UTC(y, m - 1, d + n))
  return { y: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() }
}

const dos = (n: number) => String(n).padStart(2, "0")
const aTexto = (f: { y: number; m: number; d: number }) => `${f.y}-${dos(f.m)}-${dos(f.d)}`

/** "HH:MM" → minutos desde la medianoche. Lanza con un valor inválido. */
function minutosDeCorte(horaCorte: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(horaCorte)
  if (!m) throw new Error(`Hora de corte inválida: ${horaCorte}`)
  return Number(m[1]) * 60 + Number(m[2])
}

export function fechaEntrega(confirmadoEn: Date, horario: HorarioEnvio): FechaEntrega {
  if (horario.dias.length === 0) throw new Error("El método no tiene días operativos")
  const corte = minutosDeCorte(horario.horaCorte)
  const hoy = partesLocales(confirmadoEn)
  const operativo = horario.dias.includes(diaIso(hoy.y, hoy.m, hoy.d))
  if (operativo && hoy.minutos < corte - horario.margenMin) {
    return { fecha: aTexto(hoy), mismoDia: true }
  }
  for (let n = 1; n <= 14; n++) {
    const f = sumarDias(hoy.y, hoy.m, hoy.d, n)
    if (horario.dias.includes(diaIso(f.y, f.m, f.d))) return { fecha: aTexto(f), mismoDia: false }
  }
  throw new Error("No se encontró un día operativo")
}
