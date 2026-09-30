/**
 * ¿Se puede mostrar una búsqueda frecuente a TODO el mundo? Módulo puro.
 *
 * Las "Búsquedas frecuentes" de la guía salen de lo que escriben los
 * visitantes. Con el mínimo de usos solo, cualquiera podría repetir tres veces
 * un texto (spam, un nombre) y publicarlo en la tienda. Por eso sólo se
 * muestra una consulta si TODAS sus palabras son vocabulario conocido:
 * - palabras de los nombres de las categorías del tenant (en singular);
 * - sinónimos del diccionario de atributos;
 * - palabras vacías y el léxico de contexto de residuo.ts;
 * - medidas y modelos con una forma conservadora ("50w", "12v", "3000k",
 *   "e27", "gu10", "ip65", "5050", "2x1.5").
 */
import { ATRIBUTOS, normalizarTexto } from "../catalogo-atributos";
import { raizPlural } from "../catalogo-busqueda";
import { tokensDe } from "./deterministico";
import { LEXICO_CONTEXTO, PALABRAS_VACIAS } from "./residuo";
import type { NodoArbol } from "./tipos";

/** Medidas y modelos que pueden aparecer en una búsqueda publicable. */
const ESPECIFICACION = [
  /^\d{1,5}(w|v|vcc|vac|k|mm|cm|m|mts|a|lm|hz)$/,
  /^(e|gu|mr|g|gx|r)\d{1,2}$/,
  /^ip\d{2}$/,
  /^\d{1,4}$/,
  /^\d{1,2}x\d{1,2}([.,]\d{1,2})?$/,
];

/** Todas las palabras conocidas para un árbol de categorías (normalizadas, también en singular). */
export function vocabularioConocido(arbol: readonly NodoArbol[]): Set<string> {
  const palabras = [
    ...arbol.flatMap((n) => tokensDe(normalizarTexto(n.nombre))),
    ...ATRIBUTOS.flatMap((a) => a.sinonimos.flatMap((s) => s.split(" "))),
    ...PALABRAS_VACIAS,
    ...LEXICO_CONTEXTO,
  ];
  return new Set(palabras.flatMap((p) => [p, raizPlural(p)]));
}

/** ¿Todas las palabras de la consulta (ya normalizada) son vocabulario conocido? */
export function esBusquedaPublicable(consultaNorm: string, vocabulario: ReadonlySet<string>): boolean {
  const tokens = tokensDe(consultaNorm);
  return (
    tokens.length > 0 &&
    tokens.every((t) => vocabulario.has(t) || vocabulario.has(raizPlural(t)) || ESPECIFICACION.some((r) => r.test(t)))
  );
}
