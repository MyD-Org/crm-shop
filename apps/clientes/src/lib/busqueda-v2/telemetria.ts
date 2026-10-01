/**
 * Telemetría de la búsqueda v2 del lado del navegador (por `lib/tracking`:
 * flag `tracking`, sólo PostHog). Módulo sin React; lo usa CatalogoClient.
 *
 * - `busqueda_enviada`: al llegar a la página 1 de una búsqueda entendida
 *   (`ia=1`), con el resumen que dejó `/buscar` en una cookie de vida corta
 *   (se lee una vez y se borra: recargar o paginar no es otra búsqueda) y el
 *   total que se ve. La consulta viaja normalizada y sólo si no parece un
 *   dato personal.
 * - `busqueda_resultado_click`: posición absoluta del producto elegido.
 */
import { normalizarConsulta } from "../busqueda-inteligente/normalizar";
import { track } from "../tracking/track";
import { COOKIE_RESUMEN, leerCookieResumen } from "./resumen";

/** Productos por página del catálogo (igual que `PRODUCTOS_POR_PAGINA` de catalog.ts, que es de servidor). */
export const POR_PAGINA = 24;

function leerCookie(nombre: string, cookies: string): string | undefined {
  const par = cookies.split("; ").find((c) => c.startsWith(`${nombre}=`));
  return par?.slice(nombre.length + 1);
}

/** Dispara `busqueda_enviada` si `/buscar` dejó su resumen, y lo borra. `doc` se inyecta en los tests. */
export function enviarBusquedaEnviada(
  consulta: string,
  total: number,
  doc: { cookie: string } | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!doc) return false;
  const resumen = leerCookieResumen(leerCookie(COOKIE_RESUMEN, doc.cookie));
  if (!resumen) return false;
  doc.cookie = `${COOKIE_RESUMEN}=; path=/; max-age=0; samesite=lax`;
  const norm = normalizarConsulta(consulta);
  track({ tipo: "busqueda_enviada", ...resumen, total, ...(norm ? { consulta: norm } : {}) });
  return true;
}

/** `busqueda_resultado_click` con la posición absoluta (1-based) en el listado. */
export function enviarClickResultado(pagina: number, indice: number, ia: boolean): void {
  track({ tipo: "busqueda_resultado_click", posicion: (pagina - 1) * POR_PAGINA + indice + 1, ia });
}
