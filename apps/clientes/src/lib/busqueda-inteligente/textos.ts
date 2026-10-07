/**
 * Copy de la búsqueda inteligente del Shop: chip de la búsqueda, "sin resultados",
 * placeholder que rota y guía del buscador. Español formal de usted
 * (CLAUDE.md; lo verifica textos.test.ts). Módulo puro: lo importan
 * componentes cliente.
 */

export const TEXTOS_FRANJA = {
  quitarTexto: (texto: string) => `Quitar la búsqueda «${texto}»`,
  texto: (texto: string) => `Búsqueda: «${texto}»`,
} as const;

export const TEXTOS_SIN_RESULTADOS = {
  titulo: (consulta: string) => `No encontramos productos para "${consulta}"`,
  conAlternativas: "Pruebe con alguna de estas opciones o elija una categoría de la lista.",
  sinAlternativas: "Puede buscar con otras palabras o elegir una categoría de la lista.",
  alternativas: "Quizás le sirva:",
  verTodos: "Ver todos los productos",
  /** Hay filtros puestos: la búsqueda sola, sin ellos. */
  sinFiltros: (consulta: string) => `Buscar «${consulta}» sin filtros`,
  /** La combinación de búsqueda y filtros es la que da 0. */
  conFiltros: "Ningún producto cumple la búsqueda junto con los filtros elegidos. Puede quitar los filtros o la búsqueda.",
  relacionados: "Ver productos relacionados",
  /** Con el filtro "Con stock en <local>" activo: el 0 puede venir de ese filtro. */
  tituloLocal: (local: string, consulta?: string) =>
    consulta
      ? `No hay productos con stock en ${local} para «${consulta}»`
      : `No hay productos con stock en ${local}`,
  descripcionLocal: "Puede ver los productos de todos los locales.",
  verEnTodosLosLocales: "Ver en todos los locales",
  /** Con "Solo con stock" (el default) la búsqueda da 0, pero hay productos sin stock que coinciden. */
  sinStock: (n: number) =>
    n === 1
      ? "Hay 1 producto sin stock que coincide con su búsqueda."
      : `Hay ${n} productos sin stock que coinciden con su búsqueda.`,
  verSinStock: "Ver también los productos sin stock",
} as const;

/** Aviso de que el filtro "Con stock en <local>" se aplicó solo, por el local recordado (cookie). */
export const TEXTOS_LOCAL_RECORDADO = {
  aviso: (local: string) => `Mostrando productos con stock en ${local} (lo eligió antes).`,
  accion: "Ver todos los locales",
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
