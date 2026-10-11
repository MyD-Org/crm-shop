// Semana del calendario de marketing: lunes a domingo en hora Argentina (UTC-3, sin horario de verano).
import type { PiezaDto } from "./tipos"

const OFFSET_MS = 3 * 60 * 60 * 1000
const DIA_MS = 24 * 60 * 60 * 1000

function diaLocal(d: Date): string {
  return new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10)
}

export function rangoSemana(fechaIso: string | undefined, hoy = new Date()): { desde: Date; hasta: Date; dias: string[] } {
  const base = fechaIso && /^\d{4}-\d{2}-\d{2}$/.test(fechaIso) && !isNaN(Date.parse(fechaIso)) ? fechaIso : diaLocal(hoy)
  const medianoche = new Date(`${base}T00:00:00.000Z`)
  const dow = (medianoche.getUTCDay() + 6) % 7 // 0 = lunes
  const lunes = new Date(medianoche.getTime() - dow * DIA_MS)
  const dias = Array.from({ length: 7 }, (_, i) => new Date(lunes.getTime() + i * DIA_MS).toISOString().slice(0, 10))
  const desde = new Date(lunes.getTime() + OFFSET_MS)
  return { desde, hasta: new Date(desde.getTime() + 7 * DIA_MS), dias }
}

export function agruparPorDia(piezas: PiezaDto[], dias: string[]): Record<string, PiezaDto[]> {
  const grupos: Record<string, PiezaDto[]> = { sin_fecha: [] }
  for (const d of dias) grupos[d] = []
  for (const p of piezas) {
    const clave = p.programadaPara ? diaLocal(new Date(p.programadaPara)) : "sin_fecha"
    ;(grupos[clave] ??= []).push(p)
  }
  return grupos
}
