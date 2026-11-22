/**
 * Enlaces a `/buscar` (búsqueda v2). Módulo puro: lo usan el buscador del
 * header, la sección "Cuéntenos qué necesita" del inicio y el "sin
 * resultados", sólo con el flag `busqueda-ia` prendido (apagado, el buscador
 * sigue yendo directo a `/catalogo?q=`).
 */
import { STOCK_SOLO_CON_STOCK } from "../catalogo-url";

/** Ruta del route handler que entiende la búsqueda y redirige al catálogo. */
export const RUTA_BUSCAR = "/buscar";

/**
 * `/buscar?q=…`. Sin filtros: la búsqueda llega al catálogo con el default de la tienda (todos, los
 * sin stock al final, sin chip) y nunca agrega uno que la persona no eligió. `soloStock` sólo
 * conserva la elección de quien ya había prendido "Solo con stock" (el "Ver productos relacionados"
 * del catálogo).
 */
export function hrefBuscar(texto: string, soloStock = false): string {
  const sp = new URLSearchParams({ q: texto.trim() });
  if (soloStock) sp.set("stock", STOCK_SOLO_CON_STOCK);
  return `${RUTA_BUSCAR}?${sp.toString()}`;
}
