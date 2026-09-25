import { useEffectEvent, useLayoutEffect } from "react";

/**
 * Corre `accion` cuando la ruta queda oculta (o el componente se desmonta).
 *
 * Con Cache Components, Next no desmonta la página al navegar: la esconde con
 * `<Activity>` y al volver aparece con el estado intacto. Para lo transitorio
 * (hojas, diálogos, mensajes de un envío ya hecho) eso no sirve: hay que
 * cerrarlo al salir. `useLayoutEffect` hace la limpieza antes de ocultar, sin
 * un cuadro con el estado viejo. Ver la guía `preserving-ui-state` de Next.
 */
export function useAlOcultar(accion: () => void) {
  const alOcultar = useEffectEvent(accion);
  useLayoutEffect(() => () => alOcultar(), []);
}
