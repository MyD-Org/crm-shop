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

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Subtotal, IVA y total de una cantidad nueva con el unitario ya cotizado.
 * Mismo redondeo que `cotizarItem` (src/lib/cotizacion.ts): subtotal al
 * centavo, IVA al centavo sobre ese subtotal, y la suma. Así, cuando llega la
 * cotización, el número no salta por un centavo.
 */
function montosDe(linea: LineaPrecio, qty: number) {
  const subtotal = redondear(linea.precioUnitario * qty);
  const iva = redondear(subtotal * (linea.ivaPorcentaje / 100));
  return { subtotal, iva, total: redondear(subtotal + iva) };
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
  const total = vigente ? vigente.total : montosDe(linea, qty).total;
  return { unitario, neto: linea.precioUnitario, total };
}

/**
 * Totales del resumen mientras se recotiza: cambiar una cantidad no tiene por
 * qué esperar al servidor, el unitario de cada producto ya se conoce. Se
 * muestran al instante y la cotización que llega después los confirma (y el
 * checkout vuelve a cotizar antes de registrar el pedido).
 *
 * null si falta algún producto en la última cotización (recién agregado) o
 * alguno tiene problema: ahí no hay con qué estimar y se espera al servidor.
 * El envío no entra: el carrito siempre cotiza como retiro.
 */
export function totalesEstimados(
  items: { id: string; qty: number }[],
  ultimas: LineaPrecio[] | null,
): { subtotal: number; iva: number; total: number; unidades: number } | null {
  if (!ultimas || items.length === 0) return null;
  const porId = new Map(ultimas.map((l) => [l.id, l]));
  let subtotal = 0;
  let iva = 0;
  let unidades = 0;
  for (const item of items) {
    const linea = porId.get(item.id);
    if (!linea || linea.problema) return null;
    const m = montosDe(linea, item.qty);
    subtotal += m.subtotal;
    iva += m.iva;
    unidades += item.qty;
  }
  subtotal = redondear(subtotal);
  iva = redondear(iva);
  return { subtotal, iva, total: redondear(subtotal + iva), unidades };
}
