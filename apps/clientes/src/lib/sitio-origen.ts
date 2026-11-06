/**
 * Sitio (origen) donde se hizo un pedido (`orders.sitio_origen`, migración 0044). El mismo código
 * corre en más de un dominio y el mail del pedido tiene que linkear al sitio donde se compró.
 * Nunca sale de headers del request: sólo del entorno del despliegue.
 */

const LOCAL = new Set(["localhost", "127.0.0.1"]);

/** Origen normalizado (https; http sólo local) o null si no es una URL válida. */
export function normalizarOrigenSitio(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol === "http:" && !LOCAL.has(u.hostname)) return null;
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u.origin.toLowerCase();
}

/** Sitio de este despliegue: `NEXT_PUBLIC_SITE_URL` normalizada. */
export function sitioOrigenDeEntorno(): string | null {
  return normalizarOrigenSitio(process.env.NEXT_PUBLIC_SITE_URL);
}

/**
 * Base de los links de los mails de un pedido: el sitio guardado si es válido; si no (pedido
 * anterior a 0044 o dato roto), el del entorno, que es lo que usaban los mails hasta ahora.
 */
export function sitioParaMailDelPedido(guardado: string | null | undefined): string | undefined {
  return normalizarOrigenSitio(guardado) ?? sitioOrigenDeEntorno() ?? undefined;
}
