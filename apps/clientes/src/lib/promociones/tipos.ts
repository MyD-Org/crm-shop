import type { TextosSeccion } from "@/data/home-defaults";

/*
 * Sección "Promociones" de la home (spec 2026-10-26-promociones-home §1). Vive acá y no en
 * home-defaults.ts para que la lógica pura (`promo.ts`) no arrastre el resto del contenido;
 * home-defaults.ts la re-exporta.
 */

/** Un precio relevado en otro canal ("Tiendas online", "Casas de iluminación"…), con IVA. */
export type Referencia = { etiqueta: string; precio: number };

export type ItemPromo = {
  sku: string;
  /**
   * Nuestro precio habitual por transferencia (con IVA), el que se tacha. El editor lo completa con
   * el precio del día al agregar el producto, antes de cargar el ajuste de promo en el CRM: después
   * la tienda ya no lo ve. Ausente = sin tachado ni % de descuento.
   */
  precioHabitual?: number;
  /** Hasta 3 precios de otros canales para la escalera de comparación. Ausente = sin comparación. */
  referencias?: Referencia[];
};

export type EstrellaPromo = ItemPromo & {
  /** Link de YouTube/Vimeo (validado con `videoEmbebible`). Ausente = foto del producto. */
  video?: string;
  /** Unidades a precio de apertura. Ausente = sin contador. */
  unidadesPromo?: number;
  /** Stock del producto EN `sucursal` al guardar `unidadesPromo` (lo completa el editor). */
  stockBase?: number;
  /** Sucursal cuyo stock cuenta las unidades (slug). Ausente = la predeterminada. */
  sucursal?: string;
  /** Textos propios de la tarjeta estrella; vacíos = nombre del producto. */
  titulo?: string;
  bajada?: string;
};

export type PromocionesContent = TextosSeccion & {
  eyebrow?: string;
  /** ISO con offset; ausente = ya empezó. */
  inicio?: string;
  /** ISO con offset; obligatorio si hay productos. */
  fin?: string;
  estrella?: EstrellaPromo;
  items: ItemPromo[];
  etiquetaBadge: string;
  /** Título de la comparación de la estrella y de la ficha ("Nosotros comparamos. Usted ahorra."). */
  tituloComparador: string;
  /** Día del relevamiento de precios (YYYY-MM-DD). Se muestra junto a la comparación. */
  fechaRelevamiento?: string;
  /** Admite {inicio} {fin} {unidades}. */
  legales?: string;
  linkTodos?: string;
};
