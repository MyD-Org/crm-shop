/**
 * Token de la sesión de compra del invitado, del lado del navegador (change `compra-como-invitado`).
 *
 * Vive SOLO en la memoria de la página (una variable del módulo): ni cookie, ni localStorage, ni
 * sessionStorage. Si se recarga la pantalla se pierde a propósito; quien vuelve usa el enlace
 * «Pagar su pedido» del correo o la URL de retorno de Mercado Pago (`?t=`), que la página lee una vez
 * y limpia.
 *
 * `fetchConToken` es el `fetch` de los endpoints del pedido: agrega `X-Pedido-Token` cuando hay token
 * y la URL es de la propia API. El token NUNCA viaja en el cuerpo ni en la query.
 */

export const HEADER_TOKEN_PEDIDO = "X-Pedido-Token";

let tokenEnMemoria: string | null = null;

export function fijarTokenInvitado(token: string | null | undefined): void {
  tokenEnMemoria = token && token.length > 0 ? token : null;
}

export function tokenInvitado(): string | null {
  return tokenEnMemoria;
}

/** Sólo las rutas del pedido y del cobro reciben el token. */
function esRutaDelPedido(url: string): boolean {
  return url.startsWith("/api/pedidos") || url.startsWith("/api/pagos");
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname + input.search;
  return input.url;
}

/** `init` con el header del token si corresponde; sin token devuelve el mismo `init`. */
export function conTokenInvitado(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  if (!tokenEnMemoria || !esRutaDelPedido(urlDe(input))) return init;
  const headers = new Headers(init?.headers);
  headers.set(HEADER_TOKEN_PEDIDO, tokenEnMemoria);
  return { ...init, headers };
}

/** `fetch` de los endpoints del pedido (lee el `fetch` global en cada llamada). */
export const fetchConToken: typeof fetch = (input, init) => fetch(input, conTokenInvitado(input, init));

/** La URL sin el parámetro `t` (el token de retorno de Mercado Pago), o null si no lo tenía. */
export function urlSinToken(href: string): string | null {
  const u = new URL(href, "http://local.invalid");
  if (!u.searchParams.has("t")) return null;
  u.searchParams.delete("t");
  return u.pathname + u.search + u.hash;
}

/** Saca `t` de la barra de direcciones sin recargar ni navegar. */
export function quitarTokenDeLaUrl(): void {
  if (typeof window === "undefined") return;
  const limpia = urlSinToken(window.location.href);
  if (limpia !== null) window.history.replaceState(window.history.state, "", limpia);
}
