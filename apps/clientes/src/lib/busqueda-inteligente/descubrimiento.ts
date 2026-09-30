/**
 * Descubrimiento de la búsqueda flexible en el buscador del header (spec
 * catálogo asistido, §5): placeholder que rota y guía al enfocar. Módulo puro
 * (lo usa SearchAutocomplete); con el flag `busqueda-ia` apagado todo queda
 * como siempre.
 */
import { STOCK_INCLUYE_SIN_STOCK } from "../catalogo-url";
import { EJEMPLOS_PLACEHOLDER, placeholderDe } from "./textos";

/** Cada cuánto cambia el ejemplo del placeholder. */
export const INTERVALO_PLACEHOLDER_MS = 4000;

/** Placeholder del buscador: "Buscar" de siempre, o un ejemplo que rota. */
export function placeholderBuscador(busquedaIa: boolean, indice: number): string {
  if (!busquedaIa) return "Buscar";
  return placeholderDe(EJEMPLOS_PLACEHOLDER[indice % EJEMPLOS_PLACEHOLDER.length]);
}

/**
 * Qué muestra el desplegable del buscador:
 * - `guia`: enfocado y vacío, con el flag (ejemplos y búsquedas frecuentes);
 * - `resultados`: hay texto (el autocompletado de siempre);
 * - `null`: nada.
 */
export function vistaDesplegable(opts: { busquedaIa: boolean; abierto: boolean; texto: string; textoDebounced: string }) {
  if (!opts.abierto) return null;
  if (opts.textoDebounced.trim()) return "resultados" as const;
  if (opts.busquedaIa && !opts.texto.trim()) return "guia" as const;
  return null;
}

/**
 * URL de una búsqueda desde el header. Con todos los productos, no sólo los
 * con stock: las sugerencias incluyen los sin stock y la búsqueda tiene que
 * mostrar lo mismo.
 */
export function hrefBusqueda(texto: string): string {
  return `/catalogo?q=${encodeURIComponent(texto.trim())}&stock=${STOCK_INCLUYE_SIN_STOCK}`;
}
