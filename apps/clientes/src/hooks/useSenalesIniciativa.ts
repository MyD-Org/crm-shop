"use client";

import { useEffect, useRef } from "react";
import type { CambioCarrito } from "@/context/CartContext";
import { fijarChatAbierto, retirarTeaser } from "@/lib/chat-ia-puente";
import { idProductoDeRuta } from "@/lib/chat-ia-integracion";
import { anotarEvento } from "@/lib/iniciativa/motor";
import { MS_FICHA, esCheckout } from "@/lib/iniciativa/senales";

/**
 * Señales de la invitación proactiva que no vienen de una página puntual (ver
 * src/lib/iniciativa/): lo monta el widget del chat, así que sin chat no corre.
 *
 * - Avisa al puente si el chat está abierto (abierto no se invita).
 * - En el checkout retira la invitación que hubiera.
 * - Un agregado al carrito (`cambio` con `sentido` 1: lo que hizo el
 *   visitante, no la hidratación ni el merge) reinicia la cuenta de búsquedas
 *   y corta la espera de la ficha.
 * - `MS_FICHA` en la misma ficha, con la pestaña a la vista y sin agregar,
 *   es la señal `ficha`.
 */
export function useSenalesIniciativa({
  pathname,
  abierto,
  cambio,
}: {
  pathname: string;
  abierto: boolean;
  cambio: CambioCarrito;
}) {
  useEffect(() => fijarChatAbierto(abierto), [abierto]);

  useEffect(() => {
    if (esCheckout(pathname)) retirarTeaser();
  }, [pathname]);

  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const producto = idProductoDeRuta(pathname);
  useEffect(() => {
    if (!producto) return;
    espera.current = setTimeout(() => {
      espera.current = null;
      if (document.visibilityState === "visible") anotarEvento({ tipo: "ficha-sin-agregar" });
    }, MS_FICHA);
    return () => {
      if (espera.current) clearTimeout(espera.current);
      espera.current = null;
    };
  }, [producto]);

  // El primer valor es el de montaje (0): solo cuentan los cambios posteriores.
  const ultimoCambio = useRef(cambio.n);
  useEffect(() => {
    if (cambio.n === ultimoCambio.current) return;
    ultimoCambio.current = cambio.n;
    if (cambio.sentido !== 1) return;
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
    anotarEvento({ tipo: "agregado" });
  }, [cambio]);
}
