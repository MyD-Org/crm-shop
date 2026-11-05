import type { ProductImage, VideoProducto } from "@/data/products";

/**
 * Lista mixta de la galería de la ficha y de su visor: primero las fotos, después los videos.
 * El índice de un elemento es el mismo en el carrusel, las miniaturas y el visor, así que
 * `inicial` y `onCerrar(activa)` siguen siendo un número.
 */
export type ItemGaleria =
  { tipo: "foto"; url: string; alt?: string } | { tipo: "video"; id: string; embed: string; poster: string; posterRespaldo: string };

export function armarItems(fotos?: ProductImage[], videos?: VideoProducto[]): ItemGaleria[] {
  return [
    ...(fotos ?? []).map((f): ItemGaleria => ({
      tipo: "foto",
      url: f.url,
      alt: f.alt,
    })),
    ...(videos ?? []).map((v): ItemGaleria => ({
      tipo: "video",
      id: v.id,
      embed: v.embed,
      poster: v.poster,
      posterRespaldo: v.posterRespaldo,
    })),
  ];
}

/** Clave estable de un elemento para `key` de React. */
export function claveItem(item: ItemGaleria): string {
  return item.tipo === "foto" ? item.url : `video:${item.id}`;
}

/**
 * Id del video que arranca reproduciéndose al abrir el visor: sólo si se pidió reproducir y el
 * slide inicial es un video. null = nada suena hasta tocar play.
 */
export function reproduccionInicial(items: ItemGaleria[], inicial: number, reproducir: boolean): string | null {
  const item = items[inicial];
  return reproducir && item?.tipo === "video" ? item.id : null;
}

/** El iframe sólo se monta en el slide activo y sólo para el video que se mandó a reproducir. */
export function debeMontarIframe(
  item: ItemGaleria,
  indice: number,
  activa: number,
  reproduciendoId: string | null,
): boolean {
  return item.tipo === "video" && indice === activa && reproduciendoId === item.id;
}

/** Etiqueta del diálogo del visor: conserva "Fotos de …" si no hay videos. */
export function etiquetaVisor(items: ItemGaleria[], nombre: string): string {
  return items.some((i) => i.tipo === "video") ? `Fotos y videos de ${nombre}` : `Fotos de ${nombre}`;
}
