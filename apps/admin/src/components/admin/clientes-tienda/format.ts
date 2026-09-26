// Fechas de "Clientes de la tienda". Módulo PURO: lo usa un componente cliente que se
// renderiza primero en el servidor, así que la zona horaria va FIJA. Un `toLocale*` sin zona da
// un día en el server (UTC) y otro en el navegador (-03): hydration mismatch.

const FECHA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
})

/** ISO → "21/09/2026" en hora de Argentina. `null`/inválido → "—". Se arma desde las partes. */
export function fmtFechaCliente(iso: string | null): string {
  if (!iso) return "—"
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return "—"
  const parte: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const { type, value } of FECHA.formatToParts(fecha)) parte[type] = value
  return `${parte.day}/${parte.month}/${parte.year}`
}
