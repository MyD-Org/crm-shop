/**
 * Copy de la iniciativa del asesor (spec catálogo asistido fase 2, §3):
 * puntos de entrada estáticos (ficha, inicio, carrito) y la invitación
 * proactiva (teaser del launcher). Módulo puro: lo importan componentes cliente.
 *
 * Dos registros, a propósito:
 * - Lo que ve el visitante en el Shop (títulos, enlaces, frases del teaser) va
 *   en **usted** (CLAUDE.md). Lo verifica textos.test.ts.
 * - Lo que se manda como mensaje DEL USUARIO al chat (`MENSAJES_AL_CHAT`) es
 *   la voz del visitante hablándole al asesor, que conversa de vos (excepción
 *   del asistente vendedor, ADR 0014): puede ir en vos. Por eso vive acá y no
 *   en los componentes que tienen guarda de voseo (carrito, home).
 */

export const TEXTOS_DUDAS_PRODUCTO = {
  titulo: "¿Dudas sobre este producto?",
  bajada: "Consulte al asesor. Toque una pregunta para empezar.",
  region: "Preguntas sugeridas sobre este producto",
  preguntar: (pregunta: string) => `Preguntar al asesor: ${pregunta}`,
} as const;

/** Lo fijo de "Cuéntenos qué necesita"; los textos y ejemplos se editan desde
 *  la home (sección `busquedaAsistida` de `home-defaults.ts`). */
export const TEXTOS_CUENTENOS = {
  etiqueta: "Qué necesita",
  buscar: "Buscar",
  buscarEjemplo: (ejemplo: string) => `Buscar ${ejemplo}`,
} as const;

export const TEXTOS_CARRITO_ASESOR = {
  pregunta: "¿Le falta algo?",
  accion: "Consultar al asesor",
} as const;

/** Frases del teaser (usted, tabla de la spec) y sus dos acciones. */
export const TEXTOS_TEASER = {
  sinResultados: "¿No encontró lo que buscaba? Puedo ayudarle a elegir.",
  busquedas: "¿Le ayudo a encontrarlo más rápido?",
  ficha: "¿Tiene dudas sobre este producto?",
  aceptar: "Sí, ayúdeme",
  cerrar: "Cerrar",
} as const;

/**
 * Primeros mensajes que se envían al chat en nombre del visitante (su voz, en
 * vos: ver el comentario del módulo). El contexto de pantalla ya lleva la
 * ficha, el catálogo o el carrito: el mensaje no repite datos.
 */
export const MENSAJES_AL_CHAT = {
  carrito: "Revisá mi carrito y decime si me falta algo para la instalación",
  sinResultados: (consulta: string) => `Busqué «${consulta}» y no encontré resultados. ¿Me ayudás a elegir?`,
  busquedas: (consultas: readonly string[]) =>
    `Estoy buscando y no lo encuentro. Probé con: ${consultas.map((c) => `«${c}»`).join(", ")}. ¿Me ayudás?`,
  ficha: "Tengo dudas sobre este producto. ¿Me ayudás?",
} as const;
