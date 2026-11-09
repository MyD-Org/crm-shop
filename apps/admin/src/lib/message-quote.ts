import type { QuotedMessageRef } from "./inbox-api"
import { previewText } from "./message-text"

// Respuestas citadas en el inbox: el extracto que se dibuja arriba de la burbuja (o en el
// cuadro de respuesta) cuando un mensaje responde a otro.

/** Quién escribió el mensaje citado, como se lee arriba del extracto. */
export function quoteAuthorLabel(source: string | null | undefined): string {
  if (source === "customer") return "Cliente"
  if (source === "bot") return "Bot"
  if (source === "human") return "Operador"
  return "Mensaje"
}

/**
 * Extracto de una línea. Si el citado era un adjunto, la marca del bot ("[El cliente envió
 * una imagen]") se traduce a ícono + etiqueta, igual que en la lista de conversaciones.
 */
export function quoteExcerpt(text: string, max = 140): string {
  const flat = previewText(text).replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** Lo que el envío optimista pone como cita mientras el POST está en vuelo. */
export function quoteFromMessage(m: { id: string; text: string; source: string | null }): QuotedMessageRef {
  return { id: m.id, text: quoteExcerpt(m.text), source: m.source }
}

/** Una burbuja sólo se puede citar si ya tiene id real (no la optimista en vuelo). */
export function canQuote(m: { id: string; pending?: boolean }): boolean {
  return !m.pending && !m.id.startsWith("temp-")
}

/** id del elemento de una burbuja en el DOM, para llevar a ella al tocar una cita. */
export function bubbleDomId(messageId: string): string {
  return `msg-${messageId}`
}
