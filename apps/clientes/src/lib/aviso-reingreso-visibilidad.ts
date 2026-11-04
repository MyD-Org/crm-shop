/**
 * ¿La ficha ofrece "Avisarme cuando ingrese"? Puro: lo usa ProductoClient y se testea solo.
 *
 * Sí solo con el flag ON, el producto (la variante elegida) agotado y SIN modalidad de venta sin
 * stock (`agotadoSinModalidad`), comprable (con precio y sin precio de cuenta pendiente) e
 * inventariable (`stockQty` ausente = no inventariable: nunca se ofrece).
 */
import type { Product } from "@/data/products";
import { agotadoSinModalidad } from "./venta-sin-stock";

export function mostrarAvisoReingreso(entrada: {
  habilitado: boolean;
  producto: Pick<Product, "stock" | "stockQty" | "ventaSinStock">;
  noComprable: boolean;
}): boolean {
  const { habilitado, producto, noComprable } = entrada;
  return habilitado && !noComprable && agotadoSinModalidad(producto) && producto.stockQty !== undefined;
}
