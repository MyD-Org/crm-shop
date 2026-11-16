// Formato y etiquetas de Compras para la UI (puro; usable desde componentes cliente).

export function formatoPesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(centavos / 100)
}

/** "2026-11-10" -> "10/11/2026" sin pasar por Date (evita el corrimiento por huso horario). */
export function formatoFecha(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-")
  return a && m && d ? `${d}/${m}/${a}` : iso
}

export type TonoEstado = "neutral" | "success" | "warning" | "danger" | "info"

const ESTADOS: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  creando: { etiqueta: "Verificando con Alegra", tono: "warning" },
  pendiente: { etiqueta: "Pendiente de recepción", tono: "info" },
  parcial: { etiqueta: "Recibida parcialmente", tono: "warning" },
  completa: { etiqueta: "Recibida", tono: "success" },
  cerrada_faltante: { etiqueta: "Cerrada con faltante", tono: "neutral" },
  anulada: { etiqueta: "Anulada", tono: "neutral" },
  anulada_en_alegra: { etiqueta: "Anulada en Alegra", tono: "danger" },
}

export function estadoCompra(estado: string): { etiqueta: string; tono: TonoEstado } {
  return ESTADOS[estado] ?? { etiqueta: estado, tono: "neutral" }
}

/** Aviso fijo: el CRM nunca escribe costos; el costo promedio lo actualiza Alegra. */
export const AVISO_COSTO_PROMEDIO =
  "El costo promedio de los productos lo actualiza Alegra. Registrar esta compra no modifica los costos del CRM."

/** Acciones disponibles según el estado (confirmación previa en la UI para todas las que escriben). */
export function accionesDeCompra(estado: string, tieneRecepciones: boolean): { editar: boolean; anular: boolean } {
  const modificable = estado === "pendiente" && !tieneRecepciones
  return { editar: modificable, anular: modificable }
}
