import type { TextosSeccion } from "@/data/home-defaults";

/**
 * Sección "Promociones" de la home (spec 2026-10-26-promociones-home §1). Vive acá y no en
 * home-defaults.ts para que la lógica pura (`promo.ts`) no arrastre el resto del contenido;
 * home-defaults.ts la re-exporta.
 */
export type ItemPromo = {
  sku: string;
  /** Precio con IVA visto en otras tiendas. Ausente = sin línea de referencia ni % de ahorro. */
  precioReferencia?: number;
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
  etiquetaReferencia: string;
  /** Admite {inicio} {fin} {unidades}. */
  legales?: string;
  linkTodos?: string;
};
