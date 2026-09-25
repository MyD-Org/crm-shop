/**
 * Regla de registro formal de usted (CLAUDE.md raíz) compartida por las
 * guardas estáticas `sin-voseo.test.ts`. Solo mira el texto: los comentarios
 * se blanquean antes de buscar.
 */

export const REGISTRO =
  /\b(?:tu|tus|te|vos|sos|probá|revisá|ingresá|vinculá|elegí|escribinos|podés|tenés|dale|ojo|che)\b/i;

export function limpiar(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Líneas (`número: texto`) donde aparece el patrón, fuera de comentarios. */
export function infracciones(texto: string, patron: RegExp): string[] {
  const limpio = limpiar(texto);
  const lineas = limpio.split("\n");
  const numeros = new Set<number>();
  for (const m of limpio.matchAll(new RegExp(patron.source, patron.flags.replace("g", "") + "g"))) {
    numeros.add(limpio.slice(0, m.index).split("\n").length);
  }
  return [...numeros].sort((a, b) => a - b).map((n) => `${n}: ${lineas[n - 1].trim()}`);
}
