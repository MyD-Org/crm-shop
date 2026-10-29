"use client";

import { useSyncExternalStore } from "react";

/**
 * Reloj compartido de la promo (cuenta regresiva, vigencia de badges y ficha): un solo intervalo de
 * 1 s para toda la página. En el servidor y en la hidratación vale `null`, así nada que dependa de la
 * hora se dibuja hasta el montaje (sin mismatch).
 */
let ahora = 0;
const oyentes = new Set<() => void>();
let intervalo: ReturnType<typeof setInterval> | null = null;

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  if (!intervalo) {
    ahora = Date.now();
    intervalo = setInterval(() => {
      ahora = Date.now();
      for (const o of oyentes) o();
    }, 1000);
  }
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0 && intervalo) {
      clearInterval(intervalo);
      intervalo = null;
    }
  };
}

export function useAhora(): number | null {
  return useSyncExternalStore(
    suscribir,
    () => ahora || null,
    () => null,
  );
}

const sinSuscribir = () => () => {};

/**
 * Como `useAhora`, pero sólo se suscribe al reloj (y re-renderiza cada segundo) mientras `activo`. Para
 * componentes siempre montados (el mini-carrito del header) que sólo necesitan la hora a veces.
 */
export function useAhoraSi(activo: boolean): number | null {
  return useSyncExternalStore(
    activo ? suscribir : sinSuscribir,
    () => (activo ? ahora || null : null),
    () => null,
  );
}
