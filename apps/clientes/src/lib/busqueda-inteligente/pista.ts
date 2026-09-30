/**
 * "Enseñar haciendo" (spec catálogo asistido, §5.3): la primera vez que el
 * visitante ve la franja de la búsqueda inteligente, se suma "Puede describir
 * lo que necesita con sus palabras". Se recuerda en `localStorage`; si no hay
 * (modo privado, bloqueado, servidor), no se muestra: nunca rompe nada.
 *
 * Se decide UNA vez por carga de página (la pista acompaña a la franja
 * mientras dure esa visita, hasta que la cierre) y se marca como vista en el
 * mismo momento. Módulo puro: el almacenamiento llega como argumento.
 */

export const CLAVE_PISTA = "shop:busqueda-ia:pista-vista";

interface Almacen {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** ¿Hay que mostrar la pista? La primera vez devuelve true y la marca como vista. */
export function consumirPista(almacen: Almacen | undefined): boolean {
  if (!almacen) return false;
  try {
    if (almacen.getItem(CLAVE_PISTA)) return false;
    almacen.setItem(CLAVE_PISTA, "1");
    return true;
  } catch {
    return false;
  }
}

let decision: boolean | undefined;

/** `consumirPista` una sola vez por carga de página. */
export function pistaDeEstaCarga(almacen: () => Almacen | undefined): boolean {
  decision ??= consumirPista(almacen());
  return decision;
}

/** El visitante cerró la pista: no vuelve en esta carga. */
export function cerrarPista() {
  decision = false;
}
