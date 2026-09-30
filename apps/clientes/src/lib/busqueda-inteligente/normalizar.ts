/**
 * Normalización de la consulta para interpretarla y como clave de la caché.
 * Módulo puro.
 *
 * Privacidad: una consulta que parece un email o un teléfono NO se interpreta
 * ni se guarda (la caché alimenta las búsquedas frecuentes, que ve todo el
 * mundo). Los códigos de producto no llegan hasta acá: el gate los corta antes.
 */
import { normalizarTexto } from "../catalogo-atributos";

/** Tope de largo de la consulta normalizada (y de la columna de la caché). */
export const LARGO_MAX_CONSULTA = 120;

const EMAIL = /[^\s@]+@[^\s@]+/;
/** 10 o más dígitos con separadores de teléfono entre medio ("+54 223 555-1234"). */
const TELEFONO = /(?:\+?\d[\s\-().]{0,2}){10,}/;
/** 7 o más dígitos seguidos: DNI, teléfono local, número de cuenta. */
const DIGITOS_SEGUIDOS = /\d{7,}/;

/** ¿La consulta parece un dato personal (email, teléfono, documento)? */
export function pareceDatoPersonal(q: string): boolean {
  return EMAIL.test(q) || TELEFONO.test(q) || DIGITOS_SEGUIDOS.test(q);
}

/**
 * Minúsculas, sin tildes, sin puntuación suelta (comas, signos de pregunta,
 * comillas; quedan los guiones, barras, puntos y "°" de las medidas), espacios
 * colapsados y recortada a 120 caracteres. `null` si queda vacía o parece un
 * dato personal.
 */
export function normalizarConsulta(q: string): string | null {
  if (pareceDatoPersonal(q)) return null;
  const n = normalizarTexto(q)
    .replace(/[^\p{L}\p{N}\s\-./°]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LARGO_MAX_CONSULTA)
    .trim();
  return n || null;
}
