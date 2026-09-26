/**
 * Escala logarítmica del slider de precio del catálogo.
 *
 * El rango de precios de un catálogo real es enorme ($488 a $2.842.886, por
 * ejemplo) y la mayoría de los productos cae cerca del extremo barato. Un
 * slider LINEAL hace que ese primer tramo (donde está casi todo) ocupe un par
 * de píxeles: mover el pulgar un milímetro salta cientos de miles de pesos y
 * el filtro parece no reaccionar.
 *
 * Este módulo separa la POSICIÓN del pulgar (un entero 0..POSICION_MAX, lo
 * que arrastra el usuario) del PRECIO que esa posición representa (escala
 * logarítmica sobre el rango real), y redondea el precio resultante a un
 * valor "lindo" para que el número que ve la persona sea memorizable
 * ($5.000, no $5.023). Puro, sin React: lo usan los componentes de filtro y
 * sus tests.
 */

/** Resolución del slider: 0 = mínimo del rango, POSICION_MAX = máximo. */
export const POSICION_MIN = 0;
export const POSICION_MAX = 1000;

/**
 * Redondea a un valor "lindo" según su magnitud: pasos de 100 por debajo de
 * 1.000, de 500 por debajo de 5.000, de 1.000 por debajo de 10.000, y así
 * sucesivamente (secuencia 1-5-10-50-100... × la potencia de 10 que toque).
 * `0` y negativos quedan en `0`.
 */
export function redondearLindo(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const paso = pasoLindo(n);
  return Math.round(n / paso) * paso;
}

/** Paso de redondeo para un número: la escala 1-5 de la potencia de 10 debajo de él. */
function pasoLindo(n: number): number {
  const magnitud = 10 ** Math.floor(Math.log10(n));
  // Dentro de cada potencia de 10, el corte entre paso "1×" y "5×" es en el
  // punto medio (5×) de la potencia anterior: 100 hasta 500, 500 hasta 1.000.
  return n < magnitud * 5 ? magnitud / 2 : magnitud;
}

/** log(x+1): admite `x = 0` (el precio mínimo real puede ser $0). */
const log1p = (x: number) => Math.log(x + 1);

/**
 * Precio para una posición del slider (0..POSICION_MAX), sobre el rango real
 * `[min, max]`. Escala logarítmica + redondeo "lindo", salvo en los extremos
 * exactos (0 y POSICION_MAX), que devuelven `min` y `max` sin tocar: el
 * redondeo no debe sacar al slider de su propio rango.
 *
 * `min === max` (rango degenerado, un solo precio en el conjunto) siempre
 * devuelve ese precio.
 */
export function posicionAPrecio(posicion: number, min: number, max: number): number {
  if (min >= max) return min;
  const p = Math.min(Math.max(posicion, POSICION_MIN), POSICION_MAX);
  if (p <= POSICION_MIN) return min;
  if (p >= POSICION_MAX) return max;

  const logMin = log1p(min);
  const logMax = log1p(max);
  const t = (p - POSICION_MIN) / (POSICION_MAX - POSICION_MIN);
  const crudo = Math.exp(logMin + (logMax - logMin) * t) - 1;
  // El redondeo "lindo" puede empujar el valor fuera de (min, max); se acota.
  return Math.min(Math.max(redondearLindo(crudo), min), max);
}

/**
 * Posición del slider (0..POSICION_MAX) para un precio, inversa de
 * `posicionAPrecio` (sin el redondeo "lindo": la posición es continua, se
 * redondea al entero más cercano porque el slider trabaja en pasos de 1).
 *
 * `min === max` devuelve `POSICION_MIN`: con un solo precio posible no hay
 * escala que recorrer (y el slider se deshabilita en ese caso).
 */
export function precioAPosicion(precio: number, min: number, max: number): number {
  if (min >= max) return POSICION_MIN;
  const precioAcotado = Math.min(Math.max(precio, min), max);
  if (precioAcotado <= min) return POSICION_MIN;
  if (precioAcotado >= max) return POSICION_MAX;

  const logMin = log1p(min);
  const logMax = log1p(max);
  const t = (log1p(precioAcotado) - logMin) / (logMax - logMin);
  return Math.round(POSICION_MIN + t * (POSICION_MAX - POSICION_MIN));
}
