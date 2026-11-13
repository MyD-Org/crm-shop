/**
 * Qué parte de la URL se le manda a un proveedor de tracking.
 *
 * Sólo origen + path + los parámetros de atribución de campañas. El resto de la
 * query se descarta: el carrito compartido lleva la lista de productos en `?i=`,
 * los flujos de Clerk pueden traer tickets de sesión, `?volver=` rutas internas
 * y `?tema=` es de QA. Ninguno sirve para medir y alguno es sensible.
 */

const PARAMS_ATRIBUCION = new Set(["gclid", "gbraid", "wbraid", "fbclid"]);

function esDeAtribucion(nombre: string): boolean {
  return nombre.startsWith("utm_") || PARAMS_ATRIBUCION.has(nombre);
}

/** URL absoluta limpia; si no se puede leer como URL, "" (mejor nada que la cruda). */
export function limpiarUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const limpios = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (esDeAtribucion(k)) limpios.append(k, v);
  const query = limpios.toString();
  return `${u.origin}${u.pathname}${query ? `?${query}` : ""}`;
}

/**
 * Rutas donde no corre NINGÚN proveedor (ni pageview ni eventos ni grabación de
 * sesión): login, registro y la cortina. El Pixel de Meta manda la URL cruda del
 * documento con cada evento y no tiene forma de limpiarla, así que la única
 * protección para los parámetros de Clerk es no disparar nada ahí.
 *
 * `/pagar` (change `compra-como-invitado`): el enlace «Pagar su pedido» de los mails lleva una
 * credencial firmada en el path; ahí tampoco corre nada.
 */
const PREFIJOS_SIN_TRACKING = ["/ingresar", "/registro", "/__gate", "/__clerk", "/pagar"];

/**
 * ¿Es el checkout con el token de compra del invitado (`/checkout?...&t=<token>`)? Así vuelve de
 * Mercado Pago o Payway: esa carga no se mide (el Pixel mandaría la URL con el token). La página
 * quita `t` de la barra apenas carga, y las navegaciones siguientes ya se miden.
 */
function esCheckoutConTokenDePedido(pathname: string, search: string | undefined): boolean {
  if (!search || !(pathname === "/checkout" || pathname.startsWith("/checkout/"))) return false;
  try {
    return new URLSearchParams(search).has("t");
  } catch {
    return false;
  }
}

export function rutaSinTracking(pathname: string, search?: string): boolean {
  return PREFIJOS_SIN_TRACKING.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    esCheckoutConTokenDePedido(pathname, search);
}

/** Origen + pathname, sin query ni fragmento ni atribución; "" si no se puede leer. */
export function urlSinQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}
