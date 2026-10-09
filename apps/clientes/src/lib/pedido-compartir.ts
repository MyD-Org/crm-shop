/**
 * Compartir un pedido: arma el link del carrito compartido con SÓLO `id:qty`.
 * No viaja número ni id del pedido, importes, dirección ni estado (ver
 * `carrito-compartido.ts`). Puro: sin DB ni Next.
 */

import { esIdValido, MAX_LINEAS, normalizarCarrito, type LineaCarrito } from "./carrito-cliente";
import { hrefCompartido } from "./carrito-compartido";

export interface PedidoCompartible {
  href: string;
  /** Líneas válidas que quedan en el link (a lo sumo MAX_LINEAS). */
  lineas: number;
  /** true si el pedido tenía más líneas válidas de las que entran en el link. */
  recortado: boolean;
}

export const AVISO_PEDIDO_RECORTADO = `Se comparten las primeras ${MAX_LINEAS} líneas.`;

export function pedidoCompartible(
  items: readonly { id: string; qty: number }[],
): PedidoCompartible {
  const validas: LineaCarrito[] = [];
  for (const { id, qty } of items) {
    if (esIdValido(id) && Number.isSafeInteger(qty) && qty > 0) validas.push({ id, qty });
  }
  const { items: lineas, avisos } = normalizarCarrito(validas);
  return { href: hrefCompartido(lineas), lineas: lineas.length, recortado: avisos.includes("lineas") };
}
