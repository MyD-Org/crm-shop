import type { ProductStock } from "@myd-org/ui";

/**
 * Foto de un producto, cargada en el overlay del CRM. Estructuralmente igual a
 * `FotoOverlay` de src/db/schema.ts, pero propia: este archivo lo importan
 * componentes cliente y no debe arrastrar el esquema de la base.
 */
export interface ProductImage {
  url: string;
  /** Ancho original en px. */
  w: number;
  alt?: string;
}

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
  /** Precio NETO (sin IVA) de la lista del visitante. Lo usan carrito y cotización. */
  price: number;
  /** Alícuota de IVA conocida del ítem. undefined = sin IVA persistido todavía. */
  ivaPorcentaje?: number;
  /**
   * Precio final con IVA para exhibir (ver src/lib/precio-final.ts). undefined
   * si no hay IVA conocido: se muestra `price` como siempre, sin neto.
   */
  precioFinal?: number;
  stock: ProductStock;
  /** Unidades disponibles segun Alegra. undefined = item sin inventario. */
  stockQty?: number;
  /** `reference` en Alegra. */
  sku?: string;
  description?: string;
  /** Categoria del item en Alegra (itemCategory.name). */
  category?: string;
  /**
   * Fotos del overlay del CRM (portada = [0]), ya filtradas a los hosts de
   * medios permitidos (ver src/lib/catalogo-medios.ts). undefined = sin fotos.
   */
  images?: ProductImage[];
  oldPrice?: number;
  discount?: string;
  badgeTone?: "danger" | "info" | "warning" | "neutral";
  badgeText?: string;
}
