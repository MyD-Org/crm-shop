import type { ProductStock } from "@myd-org/ui";

/**
 * Forma de producto que renderiza el shop. Se construye a partir de un item de
 * Alegra en src/lib/catalog.ts — no hay catalogo hardcodeado.
 *
 * Los campos opcionales de marketing (oldPrice, discount, badge*) NO existen en
 * Alegra: son concepto del shop y hoy nadie los completa. Se mantienen en el
 * tipo para cuando exista esa capa (ver docs/arquitectura-integraciones.md).
 */
export interface Product {
  id: string;
  name: string;
  brand: string;
  price: number;
  stock: ProductStock;
  /** Unidades disponibles segun Alegra. undefined = item sin inventario. */
  stockQty?: number;
  /** `reference` en Alegra. */
  sku?: string;
  description?: string;
  /** Categoria del item en Alegra (itemCategory.name). */
  category?: string;
  oldPrice?: number;
  discount?: string;
  badgeTone?: "danger" | "info" | "warning" | "neutral";
  badgeText?: string;
}
