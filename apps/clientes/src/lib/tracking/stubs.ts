/**
 * Colas de `fbq` y `gtag` equivalentes a los snippets oficiales de Meta y
 * Google, instaladas desde JS y no con un <script> inline: así existen ANTES de
 * que corran los efectos que mandan el primer pageview (un `next/script` inline
 * `afterInteractive` puede llegar después de la hidratación). El script remoto
 * de cada uno (fbevents.js, gtag/js) se carga aparte y vacía la cola.
 *
 * Idempotentes: StrictMode monta dos veces en desarrollo.
 */

import type { Gtag } from "./track";

/* eslint-disable prefer-rest-params, prefer-spread -- los SDK leen `arguments`, igual que el snippet oficial */

type ColaFbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded: boolean;
  version: string;
};

export function instalarFbq(w: Window, pixelId: string): void {
  if (w.fbq) return;
  const n = function (this: unknown) {
    if (n.callMethod) n.callMethod.apply(n, arguments as unknown as unknown[]);
    else n.queue.push(arguments);
  } as unknown as ColaFbq;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  w.fbq = n;
  w._fbq ??= n;
  // Sin autoConfig: el Pixel no manda por su cuenta clics ni datos de formularios.
  n("set", "autoConfig", false, pixelId);
  n("init", pixelId);
}

export function instalarGtag(w: Window, measurementId: string): void {
  if (w.gtag) return;
  w.dataLayer = w.dataLayer || [];
  const dl = w.dataLayer;
  const gtag: Gtag = function () {
    dl.push(arguments);
  };
  w.gtag = gtag;
  gtag("js", new Date());
  // Sin page_view automático: lo manda TrackingCliente con la URL limpia.
  gtag("config", measurementId, { send_page_view: false });
}
