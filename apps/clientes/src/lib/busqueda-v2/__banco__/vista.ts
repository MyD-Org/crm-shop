/**
 * "Vista" del banco: qué productos ve quien busca. La línea base se mide con
 * la variante de siempre del banco (`VISTA_ACTUAL`: sin filtrar por visibles
 * y con stock = todos) y con la que ve el cliente en producción
 * (`vistaProduccion`). Módulo puro (sólo el parser de URL del catálogo).
 *
 * El flag `catalogo-solo-visibles` NO se lee acá: Vercel Flags no corre bajo
 * tsx. El valor se pasa explícito (`--solo-visibles=si|no`, copiado de
 * `vercel flags inspect`) y queda declarado en la cabecera de la corrida.
 */
import { SOLO_STOCK_DEFAULT, STOCK_SOLO_CON_STOCK, leerEstado, type EstadoCatalogo } from "@/lib/catalogo-url";

export interface VistaBanco {
  /** Sólo productos con overlay visible (flag `catalogo-solo-visibles`). */
  soloVisibles: boolean;
  /** "Solo con stock" prendido (el default del Shop es apagado: `SOLO_STOCK_DEFAULT`). */
  soloStock: boolean;
}

/** La variante de hoy del banco: soloVisibles false y sin filtrar stock. */
export const VISTA_ACTUAL: VistaBanco = { soloVisibles: false, soloStock: false };

/** Lo que ve el cliente: el stock por defecto del Shop y `soloVisibles` según el flag. */
export const vistaProduccion = (soloVisibles: boolean): VistaBanco => ({ soloVisibles, soloStock: SOLO_STOCK_DEFAULT });

/** Estado de catálogo de una búsqueda `q` bajo la vista (sin `stock` = el default del Shop, sin filtrar stock). */
export function estadoBase(q: string, vista: VistaBanco): EstadoCatalogo {
  return leerEstado({ q, ...(vista.soloStock ? { stock: STOCK_SOLO_CON_STOCK } : {}) });
}
