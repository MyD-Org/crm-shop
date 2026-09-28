/**
 * Cómo se parte y normaliza el texto buscado en el catálogo.
 *
 * Módulo puro (sin DB): lo usa `coincideTexto` en `catalog.ts` para armar una
 * condición por término. Vive aparte para poder testear las reglas sin SQL.
 *
 * Por qué por términos y no la frase entera: con `LIKE '%lampara led%'`, la
 * búsqueda "lampara led" no encontraba "Lámpara 9W LED". Ahora cada término
 * tiene que aparecer en algún lado del producto, en cualquier orden.
 *
 * Por qué plurales a mano y no el stemmer de Postgres (`spanish_stem`): es
 * demasiado agresivo para un `LIKE` ("lamparas" → "lamp") y a la vez no
 * resuelve "leds". Las reglas de acá son pocas, predecibles y alcanzan para el
 * vocabulario del catálogo.
 */

/** Tope de términos: cada uno es una condición más en el WHERE. */
const MAX_TERMINOS = 8;

/** Minúsculas y sin tildes (mismo criterio que `immutable_unaccent(lower())`). */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Puntuación de los bordes de un término; la de adentro queda (códigos: "TM-2x16"). */
const BORDES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Términos de la búsqueda, normalizados, sin vacíos ni repetidos. */
export function terminosBusqueda(q: string | undefined): string[] {
  if (!q) return [];
  const terminos = normalizar(q)
    .split(/\s+/)
    .map((t) => t.replace(BORDES, ""))
    .filter(Boolean);
  return [...new Set(terminos)].slice(0, MAX_TERMINOS);
}

/**
 * Singular aproximado de un plural en español, para que "lamparas" encuentre
 * "lámpara" y "leds" encuentre "LED". Como se usa dentro de un `LIKE '%…%'`,
 * quedarse corto es inofensivo ("cabl" sigue encontrando "cable"); pasarse no.
 *
 * - "-ces" → "-z" (luces → luz).
 * - "-es" tras r, n, d, j o y → sin "es" (interruptores → interruptor).
 * - "-s" → sin "s" (focos → foco, leds → led).
 *
 * Sólo palabras de letras y de 4 o más: los códigos y medidas ("10mts",
 * "e27s") y las palabras cortas ("gas", "mes") quedan como están.
 */
export function raizPlural(termino: string): string {
  if (termino.length < 4 || !/^[a-zñ]+$/.test(termino)) return termino;
  if (termino.endsWith("ces") && termino.length >= 5) return `${termino.slice(0, -3)}z`;
  if (/[rndjy]es$/.test(termino)) return termino.slice(0, -2);
  if (termino.endsWith("s")) return termino.slice(0, -1);
  return termino;
}

/** Escapa los comodines de LIKE (el escape por defecto es `\`). */
const escaparLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** `%término%`: el término en cualquier lugar. */
export function patronLike(termino: string): string {
  return `%${escaparLike(termino)}%`;
}

/** `término%`: el texto empieza con el término. */
export function patronPrefijo(termino: string): string {
  return `${escaparLike(termino)}%`;
}
