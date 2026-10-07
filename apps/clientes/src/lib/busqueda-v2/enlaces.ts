/**
 * Enlaces a `/buscar` (búsqueda v2). Módulo puro: lo usan el buscador del
 * header, la sección "Cuéntenos qué necesita" del inicio y el "sin
 * resultados", sólo con el flag `busqueda-ia` prendido (apagado, el buscador
 * sigue yendo directo a `/catalogo?q=`).
 */
import { STOCK_INCLUYE_SIN_STOCK } from "../catalogo-url";

/** Ruta del route handler que entiende la búsqueda y redirige al catálogo. */
export const RUTA_BUSCAR = "/buscar";

/**
 * `/buscar?q=…`. Sin filtros: la búsqueda llega al catálogo con el default de la tienda ("Solo con
 * stock", sin chip) y nunca agrega uno que la persona no eligió. `incluyeSinStock` sólo conserva la
 * elección de quien ya había apagado "Solo con stock" (el "Ver productos relacionados" del catálogo).
 */
export function hrefBuscar(texto: string, incluyeSinStock = false): string {
  const sp = new URLSearchParams({ q: texto.trim() });
  if (incluyeSinStock) sp.set("stock", STOCK_INCLUYE_SIN_STOCK);
  return `${RUTA_BUSCAR}?${sp.toString()}`;
}
