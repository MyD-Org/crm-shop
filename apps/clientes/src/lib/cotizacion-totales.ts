// Totales de una cotización a partir de sus líneas (puro: lo usan `cotizacion.ts`, que lee la base, y
// las reglas del cupón, que corren también en tests sin base).
import type { Cotizacion, LineaCotizada } from "./cotizacion";

export const redondear = (n: number) => Math.round(n * 100) / 100;

/** Las líneas con `problema` no suman; el envío se suma al total. */
export function totalizar(
  lineas: LineaCotizada[],
  costoEnvio: number,
): Pick<Cotizacion, "subtotal" | "iva" | "costoEnvio" | "total" | "hayProblemas"> {
  const validas = lineas.filter((l) => !l.problema);
  const subtotal = redondear(validas.reduce((a, l) => a + l.subtotal, 0));
  const iva = redondear(validas.reduce((a, l) => a + l.iva, 0));
  return {
    subtotal,
    iva,
    costoEnvio,
    total: redondear(subtotal + iva + costoEnvio),
    hayProblemas: lineas.some((l) => l.problema),
  };
}
