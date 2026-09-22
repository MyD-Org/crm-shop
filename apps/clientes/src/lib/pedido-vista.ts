/**
 * Textos derivados de un pedido para la card y el detalle de Mi cuenta.
 * Módulo PURO: lo usan componentes de servidor y de cliente.
 */
import type { OrderItem } from "@/data/orders";
import { fmtPrecio } from "./format";

/**
 * Subtítulo de una línea: "Cód. X · 2 u." en la card y, en el detalle,
 * también el unitario ("… · $ 538 c/u"). Si el código repite el nombre (el
 * ítem ya no está en el espejo y sólo queda el snapshot), no se repite.
 */
export function subtituloLinea(
  item: Pick<OrderItem, "codigo" | "nombreVisible" | "qty" | "price">,
  { detalle = false }: { detalle?: boolean } = {},
): string {
  const partes: string[] = [];
  if (item.codigo !== item.nombreVisible) partes.push(`Cód. ${item.codigo}`);
  partes.push(`${item.qty} u.`);
  if (detalle) partes.push(`${fmtPrecio(item.price)} c/u`);
  return partes.join(" · ");
}

/** Unidades del pedido: suma de cantidades, no cantidad de líneas. */
export function unidadesPedido(items: Pick<OrderItem, "qty">[]): number {
  return items.reduce((acc, i) => acc + i.qty, 0);
}

/** "1 producto" / "N productos". */
export function etiquetaUnidades(n: number): string {
  return `${n} ${n === 1 ? "producto" : "productos"}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Puede ser el id de un pedido? Los ids son uuid: cualquier otra cosa es un
 * 404 directo, sin ir a la base (Postgres rechaza un uuid mal formado con un
 * error, que terminaría en 500).
 */
export function esIdPedido(id: string): boolean {
  return UUID.test(id);
}
