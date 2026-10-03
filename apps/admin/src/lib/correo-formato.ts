import type { CorreoCarpeta } from "@/lib/correo-resend"

// Utilidades puras de presentación del correo (lista, hilo, adjuntos).

export const CARPETAS_UI: { value: CorreoCarpeta; label: string }[] = [
  { value: "inbox", label: "Recibidos" },
  { value: "archive", label: "Archivados" },
  { value: "spam", label: "Spam" },
  { value: "sent", label: "Enviados" },
  { value: "trash", label: "Papelera" },
]

/** "Ana Prueba <ana@x.example>" -> "Ana Prueba"; sin nombre, la dirección. */
export function nombreRemitente(de: string): string {
  const m = de.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return m[1].trim() || m[2].trim()
  return de.trim()
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Agrega la página siguiente sin duplicar hilos que ya estaban (por id). */
export function fusionarHilos<T extends { id: string }>(actuales: T[], nuevos: T[]): T[] {
  const vistos = new Set(actuales.map((h) => h.id))
  return [...actuales, ...nuevos.filter((h) => !vistos.has(h.id))]
}

// Zona horaria fija: el mismo texto en el servidor (UTC) y en el navegador (-03).
const ZONA = "America/Argentina/Buenos_Aires"

export function fechaCorreo(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const dia = (x: Date) => x.toLocaleDateString("en-GB", { timeZone: ZONA })
  if (dia(d) === dia(ahora)) return d.toLocaleTimeString("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false })
  const mismoAnio = d.toLocaleDateString("en-GB", { timeZone: ZONA, year: "numeric" }) === ahora.toLocaleDateString("en-GB", { timeZone: ZONA, year: "numeric" })
  return d.toLocaleDateString("en-GB", { timeZone: ZONA, day: "2-digit", month: "2-digit", ...(mismoAnio ? {} : { year: "2-digit" }) })
}

export function fechaCompletaCorreo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-GB", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
}
