/**
 * Copy de la búsqueda inteligente del Shop: franja, "sin resultados",
 * placeholder que rota y guía del buscador. Español formal de usted
 * (CLAUDE.md; lo verifica textos.test.ts). Módulo puro: lo importan
 * componentes cliente.
 */

export const TEXTOS_FRANJA = {
  entendimos: "Entendimos:",
  afinar: "Para afinar su búsqueda:",
  aplicarTodo: "Aplicar todo",
  regionFranja: "Sugerencias de búsqueda",
  talCual: (consulta: string) => `Ver resultados de «${consulta}» tal cual`,
  quitarTexto: (texto: string) => `Quitar el texto «${texto}» de la búsqueda`,
  texto: (texto: string) => `Texto: «${texto}»`,
  pista: "Puede describir lo que necesita con sus palabras.",
  cerrarPista: "Entendido",
  pregunta: "Esto parece una consulta para el asesor",
} as const;

export const TEXTOS_SIN_RESULTADOS = {
  titulo: (consulta: string) => `No encontramos productos para "${consulta}"`,
  conAlternativas: "Pruebe con alguna de estas opciones o elija una categoría de la lista.",
  sinAlternativas: "Puede buscar con otras palabras o elegir una categoría de la lista.",
  alternativas: "Quizás le sirva:",
  asesor: "¿Quiere que un asesor le ayude a elegir?",
  conversar: "Conversar",
  verTodos: "Ver todos los productos",
  relacionados: "Ver productos relacionados",
} as const;

/**
 * Ejemplos del placeholder que rota cada ~4 s: un código, una necesidad y un
 * uso. Cortos: el campo del header es angosto (el resto se desvanece).
 */
export const EJEMPLOS_PLACEHOLDER = ["DL-18W", "luz cálida para el living", "reflector para el patio"] as const;

export const placeholderDe = (ejemplo: string) => `Buscar «${ejemplo}»`;

export const TEXTOS_GUIA = {
  titulo: "Puede buscar por",
  frecuentes: "Búsquedas frecuentes",
  grupos: [
    { titulo: "Código o modelo", ejemplos: ["DL-18W", "E27 9W"] },
    { titulo: "Lo que necesita", ejemplos: ["luz cálida para el living", "tira led para la cocina"] },
    { titulo: "El ambiente", ejemplos: ["reflector para el patio", "aplique para el baño"] },
  ],
  buscarEjemplo: (ejemplo: string) => `Buscar ${ejemplo}`,
} as const;
