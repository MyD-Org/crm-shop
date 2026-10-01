/**
 * `track(evento)`: el único punto por el que el Shop manda eventos de
 * ecommerce. Lo llaman el carrito, la ficha y el checkout sin saber qué
 * proveedores hay.
 *
 * Hasta que `TrackingCliente` llama a `activarTracking` (flag `tracking`
 * prendido), los eventos esperan en una cola corta; con el flag apagado nadie
 * la vacía y no sale nada. Nunca tira: un proveedor caído o bloqueado no puede
 * romper el agregar al carrito ni el checkout.
 */
import { aGa4, aMeta, aPosthog, esEventoBusqueda, type EventoShop } from "./eventos";
import { limpiarUrl, rutaSinTracking } from "./url";

/** Firmas de `fbq` y `gtag` (los globales de Meta y Google, ver stubs.ts). */
export type Fbq = (accion: string, ...args: unknown[]) => void;
export type Gtag = (accion: string, ...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    gtag?: Gtag;
    _fbq?: unknown;
    dataLayer?: unknown[];
  }
}

export interface DestinosTracking {
  fbq?: Fbq;
  gtag?: Gtag;
  posthog?: { capture: (nombre: string, props?: object) => void };
}

interface Estado {
  destinos: DestinosTracking | null;
  cola: EventoShop[];
}

/** Cola acotada: si el flag está apagado nadie la vacía. */
const MAX_COLA = 20;

const estado: Estado = { destinos: null, cola: [] };

function ubicacion(): { pathname: string; href: string } | null {
  return typeof window === "undefined" ? null : window.location;
}

function intentar(fn: () => void) {
  try {
    fn();
  } catch {
    // Silencioso a propósito: medir nunca rompe la compra.
  }
}

function enviar(d: DestinosTracking, e: EventoShop, href: string) {
  // Los de la búsqueda no son de ecommerce: sólo PostHog.
  if (esEventoBusqueda(e)) {
    if (d.posthog) {
      const p = aPosthog(e);
      intentar(() => d.posthog!.capture(p.nombre, p.props));
    }
    return;
  }
  if (d.fbq) {
    const m = aMeta(e);
    intentar(() => d.fbq!("track", m.nombre, m.params, m.opciones));
  }
  if (d.gtag) {
    const g = aGa4(e);
    intentar(() => {
      d.gtag!("set", { page_location: limpiarUrl(href) });
      d.gtag!("event", g.nombre, g.params);
    });
  }
  if (d.posthog) {
    const p = aPosthog(e);
    intentar(() => d.posthog!.capture(p.nombre, p.props));
  }
}

export function track(e: EventoShop): void {
  const loc = ubicacion();
  if (!loc || rutaSinTracking(loc.pathname)) return;
  if (!estado.destinos) {
    if (estado.cola.length < MAX_COLA) estado.cola.push(e);
    return;
  }
  enviar(estado.destinos, e, loc.href);
}

/** Lo llama `TrackingCliente` al montar (y de nuevo cuando carga PostHog). */
export function activarTracking(destinos: DestinosTracking): void {
  estado.destinos = { ...estado.destinos, ...destinos };
  const loc = ubicacion();
  const pendientes = estado.cola.splice(0);
  if (!loc) return;
  for (const e of pendientes) enviar(estado.destinos, e, loc.href);
}

/** Sólo tests. */
export function reiniciarTracking(): void {
  estado.destinos = null;
  estado.cola = [];
}
