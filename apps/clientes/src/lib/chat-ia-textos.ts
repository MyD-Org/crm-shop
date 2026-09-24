/**
 * Textos del widget del chat (`@myd-org/ai-widget`) en usted. Los defaults del
 * widget vienen en voseo ("Escribí tu mensaje…", "Probá en un momento"), así
 * que el Shop los pisa TODOS los que el cliente ve. Sin imports de servidor:
 * lo usa el componente cliente.
 *
 * El color sale del token del DS (`--color-primary`, el que cambia con el tema
 * del sitio): el widget lo vuelca en su propia variable `--aichat-primary`, así
 * que acepta `var(...)` y no hace falta ningún hex acá.
 */
export const ETIQUETAS_CHAT = {
  headerTitle: "Asistente",
  statusOnline: "En línea",
  emptyState: "¿En qué podemos ayudarle?",
  placeholder: "Escriba su consulta…",
  sendLabel: "Enviar",
  newConversation: "Nueva conversación",
  expand: "Expandir",
  collapse: "Contraer",
  launcherAria: "Abrir el chat",
  errorAuth: "Su sesión del chat venció. Recargue la página.",
  errorRateLimit: "Hay demasiados mensajes en este momento. Inténtelo de nuevo en unos minutos.",
  errorGeneric: "Hubo un problema con el chat. Inténtelo de nuevo.",
  copyLabel: "Copiar",
  copiedLabel: "Copiado",
  sendToChannelLabel: "Enviar al canal",
  useBudgetLabel: "Usar en presupuesto",
} as const;

export const SUBTITULO_CHAT = "Consultas sobre productos y pedidos";

/** Color de marca del widget: token del DS, nunca un literal. */
export const COLOR_CHAT = "var(--color-primary)";
