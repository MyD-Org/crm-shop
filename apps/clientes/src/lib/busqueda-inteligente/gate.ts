/**
 * Gate determinista de la búsqueda inteligente: decide, sin gastar nada, si
 * vale la pena interpretar una búsqueda. Módulo puro.
 *
 * La búsqueda clásica sigue siendo instantánea y precisa: la IA sólo se suma
 * cuando la consulta parece lenguaje natural o la búsqueda trajo poco. Un
 * código de producto NUNCA se interpreta: quien pega "DL-18W" quiere ese
 * producto, no una categoría.
 */
import { normalizarTexto } from "../catalogo-atributos";
import { esTokenMedida } from "../busqueda-v2/entender/medidas";

/** Palabras que delatan una frase y no una lista de términos. */
const PALABRAS_DE_RELACION = new Set([
  "para",
  "que",
  "con",
  "sin",
  "algo",
  "donde",
  "como",
  "quiero",
  "necesito",
  "busco",
]);

/** Debajo de esto la búsqueda "trajo poco" y conviene interpretarla. */
export const POCOS_RESULTADOS = 4;

const palabras = (q: string) => normalizarTexto(q).trim().split(/\s+/).filter(Boolean);

/**
 * Un solo token con letras y dígitos, o con guiones/barras entre caracteres
 * (`DL-18W`, `NXB-125`, `C479056476B7`, `TM-2x16`). También un número suelto
 * de 3 o más cifras (código interno o EAN): no hay nada que interpretar ahí.
 *
 * Excepción: un token que es una medida pura ("20a", "ip65", "e27", "9w", "2x20") NO es un
 * código: quien lo escribe busca por esa medida. Se exige además que el valor caiga en el rango
 * de la clave, así que "12000k" o "ip70" siguen siendo códigos.
 */
export function pareceCodigo(q: string): boolean {
  const tokens = palabras(q);
  if (tokens.length !== 1) return false;
  const t = tokens[0];
  if (/^\d{3,}$/.test(t)) return true;
  if (esTokenMedida(t)) return false;
  const conLetrasYDigitos = /\p{L}/u.test(t) && /\d/.test(t);
  const conSeparador = /[\p{L}\d][-/][\p{L}\d]/u.test(t);
  return conLetrasYDigitos || conSeparador;
}

/** 3 o más palabras, o alguna palabra de relación ("para", "que", "busco"…). */
export function pareceLenguajeNatural(q: string): boolean {
  const ps = palabras(q);
  return ps.length >= 3 || ps.some((p) => PALABRAS_DE_RELACION.has(p));
}

/** No es código y (lenguaje natural o menos de `POCOS_RESULTADOS` resultados). */
export function debeInterpretar(q: string | undefined, total: number): boolean {
  if (!q?.trim() || pareceCodigo(q)) return false;
  return pareceLenguajeNatural(q) || total < POCOS_RESULTADOS;
}
