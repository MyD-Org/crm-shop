/**
 * Textos del widget del chat (`@myd-org/ai-widget`) en registro NEUTRO:
 * infinitivos y frases impersonales, sin usted ni vos. El agente vendedor
 * conversa de vos (CLAUDE.md, excepción del asistente) y el resto del Shop va
 * en usted; la UI del chat queda en el medio para no mezclar los dos registros
 * en la misma pantalla. Los defaults del widget vienen en voseo, así que el
 * Shop los pisa TODOS. Sin imports de servidor: lo usa el componente cliente.
 *
 * El color sale del token del DS (`--color-primary`, el que cambia con el tema
 * del sitio): el widget lo vuelca en su propia variable `--aichat-primary`, así
 * que acepta `var(...)` y no hace falta ningún hex acá.
 */
export const ETIQUETAS_CHAT = {
  headerTitle: "Asistente",
  statusOnline: "En línea",
  emptyState: "Consultas sobre productos, precios y pedidos",
  placeholder: "Escribir un mensaje…",
  sendLabel: "Enviar",
  newConversation: "Nueva conversación",
  expand: "Expandir",
  collapse: "Contraer",
  launcherAria: "Abrir el chat",
  errorAuth: "La sesión del chat venció. Recargar la página para continuar.",
  errorConfig: "Chat no disponible por el momento.",
  errorRateLimit: "Se alcanzó el límite de mensajes por ahora. El carrito sigue disponible.",
  errorNoCredits: "Chat no disponible por el momento.",
  errorGeneric: "Hubo un problema con el chat. Volver a intentar en unos segundos.",
  errorMessageTooLong: "El mensaje es demasiado largo. Enviarlo más corto.",
  copyLabel: "Copiar",
  copiedLabel: "Copiado",
  sendToChannelLabel: "Enviar al canal",
  useBudgetLabel: "Usar en presupuesto",
  historyLabel: "Conversaciones",
  closeHistoryLabel: "Cerrar conversaciones",
  historyNewLabel: "Nueva conversación",
  historyEmpty: "Todavía no hay conversaciones",
  untitledConversation: "Sin título",
  historySearchPlaceholder: "Buscar conversación",
  historyNoResults: "No hay conversaciones con ese texto.",
  historyGroupToday: "Hoy",
  historyGroupWeek: "Esta semana",
  historyGroupOlder: "Anteriores",
  historyRetry: "Reintentar",
  historyError: "No se pudieron cargar las conversaciones.",
  addLabel: "Agregar",
  addedLabel: "Agregado",
  addAllLabel: "Agregar todo al carrito",
  viewProductLabel: "Ver",
  handoffLabel: "Continuar por WhatsApp",
  unavailableLabel: "Sin stock",
  referenceTotalLabel: "Total de referencia",
  carouselLabel: "Productos recomendados",
  carouselPrev: "Ver anteriores",
  carouselNext: "Ver siguientes",
  stockOneLabel: "Queda 1",
  stockFewLabel: "Quedan {n}",
  codeLabel: "Cód.",
  decrementLabel: "Quitar uno",
  incrementLabel: "Agregar uno más",
  removeLabel: "Quitar del carrito",
  // Cards `catalog` y `spec` (ai-widget 0.7.0, catálogo asistido).
  availableLabel: "Disponible",
  catalogAppliedLabel: "Filtros aplicados: {summary}",
  catalogSuggestedLabel: "Filtros sugeridos: {summary}",
  catalogUndoLabel: "Deshacer",
  catalogViewLabel: "Ver en el catálogo",
  specAttributesLabel: "Características",
  specSheetLabel: "Ficha técnica (PDF)",
  // Hoja mobile (ai-widget 0.8.0, por debajo de 768 px).
  minimizeLabel: "Minimizar",
  closeLabel: "Cerrar",
  peekExpandLabel: "Abrir la conversación",
  peekEmptyLabel: "Continuar la conversación",
  peekResultsLabel: "Ver resultados",
} as const;

/** Preguntas sugeridas del chat vacío (registro neutro): cada una se envía al tocarla. */
export const SUGERENCIAS_CHAT = [
  "¿Qué lámpara conviene para un living?",
  "Reflectores para exterior",
  "Estado de un pedido",
];

/** Botón del header que abre y cierra el chat (BotonAsistente). */
export const ETIQUETA_BOTON_ASISTENTE = "Asistente";

export const SUBTITULO_CHAT = "Consultas sobre productos y pedidos";

/** Color de marca del widget: token del DS, nunca un literal. */
export const COLOR_CHAT = "var(--color-primary)";
