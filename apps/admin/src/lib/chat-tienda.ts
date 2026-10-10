// Textos del chat del Shop que se editan desde el admin (Datos → Chat de la tienda,
// `tenants.chat_empty_state` y `tenants.chat_suggestions`, migración 0078). Vacíos = el Shop
// usa sus textos por defecto. Los lee el Shop del lado servidor (apps/clientes/src/lib/chat-ia.ts).

export const CHAT_VACIO_MAX = 120
export const SUGERENCIA_MAX = 80
export const SUGERENCIAS_MAX = 4

export interface ChatTienda {
  emptyState: string
  suggestions: string[]
}

export type ParseChatTienda = { ok: true; value: ChatTienda } | { ok: false; error: string }

/** Espacios colapsados y recortados: lo que se ve en el chat. */
const limpiar = (s: string) => s.replace(/\s+/g, " ").trim()

/**
 * Valida el cuerpo del PUT. Las preguntas vacías se descartan (un campo sin completar no es
 * una pregunta) y las repetidas se juntan en una. Errores en usted: se muestran en pantalla.
 */
export function parseChatTienda(body: unknown): ParseChatTienda {
  const b = (body ?? {}) as { emptyState?: unknown; suggestions?: unknown }
  if (b.emptyState !== undefined && typeof b.emptyState !== "string") {
    return { ok: false, error: "El texto del chat vacío no es válido" }
  }
  if (b.suggestions !== undefined && (!Array.isArray(b.suggestions) || b.suggestions.some((s) => typeof s !== "string"))) {
    return { ok: false, error: "Las preguntas sugeridas no son válidas" }
  }
  const emptyState = limpiar((b.emptyState as string | undefined) ?? "")
  if (emptyState.length > CHAT_VACIO_MAX) {
    return { ok: false, error: `El texto del chat vacío admite hasta ${CHAT_VACIO_MAX} caracteres` }
  }
  const suggestions = [...new Set(((b.suggestions as string[] | undefined) ?? []).map(limpiar).filter(Boolean))]
  if (suggestions.length > SUGERENCIAS_MAX) {
    return { ok: false, error: `Indique hasta ${SUGERENCIAS_MAX} preguntas sugeridas` }
  }
  if (suggestions.some((s) => s.length > SUGERENCIA_MAX)) {
    return { ok: false, error: `Cada pregunta sugerida admite hasta ${SUGERENCIA_MAX} caracteres` }
  }
  return { ok: true, value: { emptyState, suggestions } }
}
