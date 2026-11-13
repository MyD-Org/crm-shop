"use client";

import { useEffect, useRef } from "react";

/**
 * Desafío de Cloudflare Turnstile para la compra como invitado (change `compra-como-invitado`).
 *
 * Carga el script de Cloudflare recién al montarse (sólo en el checkout del invitado) y reporta el
 * token con `onToken`; `null` cuando vence o falla (el botón de confirmar queda deshabilitado:
 * falla cerrada). `reinicio` cambia cada vez que el servidor consumió el token (un token sirve una
 * sola vez): se pide uno nuevo. Sin site key no se muestra nada y nunca hay token.
 */

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface ApiTurnstile {
  render: (el: HTMLElement, opciones: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

let cargando: Promise<void> | null = null;
function cargarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!cargando) {
    cargando = new Promise<void>((ok, mal) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => {
        cargando = null;
        mal(new Error("turnstile"));
      };
      document.head.appendChild(s);
    });
  }
  return cargando;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  reinicio = 0,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  reinicio?: number;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const idWidget = useRef<string | null>(null);
  const alToken = useRef(onToken);
  useEffect(() => {
    alToken.current = onToken;
  });

  useEffect(() => {
    if (!siteKey) {
      alToken.current(null);
      return;
    }
    let vigente = true;
    cargarScript()
      .then(() => {
        if (!vigente || !contenedor.current || !window.turnstile || idWidget.current) return;
        idWidget.current = window.turnstile.render(contenedor.current, {
          sitekey: siteKey,
          language: "es",
          "refresh-expired": "auto",
          callback: (t: string) => alToken.current(t),
          "expired-callback": () => alToken.current(null),
          "error-callback": () => alToken.current(null),
        });
      })
      .catch(() => alToken.current(null));
    return () => {
      vigente = false;
      if (idWidget.current && window.turnstile) window.turnstile.remove(idWidget.current);
      idWidget.current = null;
    };
  }, [siteKey]);

  // El servidor ya usó el token: se pide otro.
  const reinicioPrevio = useRef(reinicio);
  useEffect(() => {
    if (reinicio === reinicioPrevio.current) return;
    reinicioPrevio.current = reinicio;
    alToken.current(null);
    if (idWidget.current && window.turnstile) window.turnstile.reset(idWidget.current);
  }, [reinicio]);

  if (!siteKey) return null;
  return <div ref={contenedor} data-turnstile className="min-h-[65px]" />;
}
