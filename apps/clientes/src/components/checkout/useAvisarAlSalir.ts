"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Mientras se muestra la pantalla de transferencia de `pedidoId`, al irse de ella (otra página, cerrar
 * o esconder la pestaña, cambiar de app) le pide al servidor que mande los avisos del pedido
 * (`POST /api/pedidos/:id/avisos`, con `sendBeacon`, que sobrevive al cierre). Si el navegador no llega
 * a mandarlo, el cron lo cubre a los 15 minutos; repetirlo no duplica nada.
 *
 * Devuelve `omitir()`: para "Cambiar medio de pago", que también saca la pantalla pero no es irse
 * (el pedido sigue en el checkout y puede cambiar de medio). Si el cambio falla, el aviso queda para
 * el cron.
 */
export function useAvisarAlSalir(pedidoId: string | null): () => void {
  const omitido = useRef(false);
  const activo = useRef<string | null>(null);

  useEffect(() => {
    if (!pedidoId) return;
    activo.current = pedidoId;
    omitido.current = false;
    let enviado = false;
    const enviar = () => {
      if (enviado || omitido.current) return;
      enviado = true;
      const url = `/api/pedidos/${encodeURIComponent(pedidoId)}/avisos`;
      const encolado = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url);
      if (!encolado) void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
    };
    const alOcultar = () => {
      if (document.visibilityState === "hidden") enviar();
    };
    window.addEventListener("pagehide", enviar);
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      window.removeEventListener("pagehide", enviar);
      document.removeEventListener("visibilitychange", alOcultar);
      activo.current = null;
      // Un tick después: en desarrollo (StrictMode) el efecto se desmonta y se vuelve a montar al
      // instante; sólo es "irse" si la pantalla no volvió.
      setTimeout(() => {
        if (activo.current !== pedidoId) enviar();
      }, 0);
    };
  }, [pedidoId]);

  return useCallback(() => {
    omitido.current = true;
  }, []);
}
