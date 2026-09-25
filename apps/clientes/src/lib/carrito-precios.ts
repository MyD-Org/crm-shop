import { precioFinal } from "./precio-final";

/** Lo mínimo de una línea cotizada que hace falta para exhibir su precio. */
export interface LineaPrecio {
  id: string;
  qty: number;
  precioUnitario: number;
  ivaPorcentaje: number;
  total: number;
  problema?: unknown;
}

/**
 * Precio de una línea del carrito como en la ficha del producto: unitario con
 * IVA y, aparte, el neto ("precio sin impuestos nacionales").
 *
 * - Con la cotización vigente: su unitario y su total (el mismo que se cobra).
 * - Mientras recotiza (cambió una cantidad): el unitario de la última
 *   cotización y el total con la cantidad nueva.
 * - Sin ninguna cotización, o si la línea tiene un problema: null. El neto
 *   guardado en el carrito no se muestra como si fuera el precio.
 */
export function precioLineaCarrito(
  qty: number,
  vigente: LineaPrecio | undefined,
  ultima: LineaPrecio | undefined,
): { unitario: number; neto: number; total: number } | null {
  const linea = vigente ?? ultima;
  if (!linea || linea.problema) return null;
  const unitario = precioFinal(linea.precioUnitario, linea.ivaPorcentaje);
  if (unitario === undefined) return null;
  const total = vigente ? vigente.total : Math.round(unitario * qty * 100) / 100;
  return { unitario, neto: linea.precioUnitario, total };
}
