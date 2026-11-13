/**
 * Compara textos sin acentos, mayúsculas, espacios ni signos. Es la misma normalización de
 * `sucursales-zona.ts` y de `envio-zona.ts`; el Shop tiene su copia en `lib/texto-clave.ts`.
 */
export function claveTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}
