/**
 * Compara textos sin acentos, mayúsculas, espacios ni signos. Es la misma normalización de
 * `sucursales.ts`, `envio.ts` y `envio-zona.ts`; el CRM tiene su copia en `apps/admin/src/lib/texto-clave.ts`.
 */
export function claveTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}
