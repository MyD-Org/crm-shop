/**
 * Textos de Mi cuenta que dependen de un número o de una regla. Módulo PURO.
 */
import { fmtPrecio } from "./format";

/** Etiqueta de un contador: singular sólo con 1 (0 va en plural). */
export function etiquetaContador(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

const CONJUNCION = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

/**
 * "Enviamos a A y B en compras desde $ X (sin IVA)." Las ciudades y el mínimo
 * salen de `src/lib/envio.ts`: si cambia la regla, cambia el texto.
 */
export function textoEnvio(ciudades: readonly string[], minimo: number): string {
  return `Enviamos a ${CONJUNCION.format(ciudades)} en compras desde ${fmtPrecio(minimo)} (sin IVA).`;
}
