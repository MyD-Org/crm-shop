/**
 * Textos de Mi cuenta que dependen de un número. Módulo PURO (el texto de la regla de envío sale de `textoRegla`, `envio.ts`).
 */
/** Etiqueta de un contador: singular sólo con 1 (0 va en plural). */
export function etiquetaContador(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}
