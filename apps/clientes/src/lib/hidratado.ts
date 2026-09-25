import { useSyncExternalStore } from "react";

function sinSuscripcion(): () => void {
  return () => {};
}

/**
 * `false` mientras el componente se hidrata (y en el servidor), `true` después.
 * En un render en cliente sin hidratación (navegación) es `true` de entrada.
 *
 * Hace falta en los componentes de un hueco por request (Cache Components):
 * el hueco llega por streaming y se hidrata DESPUÉS del shell, cuando los
 * contextos de arriba (carrito, Clerk) ya tienen los valores del navegador.
 * Leerlos directo en ese render no coincide con el HTML del servidor (React
 * #418). Con este flag el primer render repite lo del servidor y el siguiente
 * pinta lo del navegador.
 */
export function useHidratado(): boolean {
  return useSyncExternalStore(
    sinSuscripcion,
    () => true,
    () => false,
  );
}
