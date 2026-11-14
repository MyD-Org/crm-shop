import { useSyncExternalStore } from "react";

/** Debajo de `lg` (64rem): el mismo corte que usan el header y las barras fijas. */
export const CONSULTA_MOBILE = "(width < 64rem)";

/**
 * Si la ventana cumple la media query, y se actualiza al cambiar. En el
 * servidor y al hidratar devuelve `false` (el HTML del servidor no sabe el
 * ancho): sólo sirve para comportamiento que aparece después de una
 * interacción, nunca para decidir qué se pinta de entrada.
 */
export function useMediaQuery(consulta: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const mq = window.matchMedia(consulta);
      mq.addEventListener("change", avisar);
      return () => mq.removeEventListener("change", avisar);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}
