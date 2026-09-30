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
 */
const PREFIJOS_SIN_TRACKING = ["/ingresar", "/registro", "/__gate", "/__clerk"];

export function rutaSinTracking(pathname: string): boolean {
  return PREFIJOS_SIN_TRACKING.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
