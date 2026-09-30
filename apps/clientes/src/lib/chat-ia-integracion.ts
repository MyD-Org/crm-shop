/**
 * Integración del Shop con el chat del asistente (ai-widget 0.7.0, spec
 * catálogo asistido §6): de los filtros que propone el agente a una URL del
 * catálogo, cuándo el chat se acopla a la derecha y cuándo puede navegar solo.
 * Módulo puro: lo usa ChatIaWidget.
 */
import type { CatalogFilters } from "@myd-org/ai-widget";
import { STOCK_INCLUYE_SIN_STOCK, hrefCatalogo, leerEstado, type EstadoCatalogo } from "./catalogo-url";

/**
 * Desde este ancho el chat abierto se acopla a la derecha (panel de alto
 * completo que empuja el contenido). Por debajo, el drawer flotante de siempre.
 */
export const MEDIA_DOCK = "(min-width: 1280px)";

/**
 * Atributo de `<html>` que marca el chat acoplado y abierto: globals.css le da
 * al `<body>` el `padding-right` del ancho del panel (`--aichat-dock-width`).
 */
export const ATRIBUTO_DOCK = "data-chat-dock";

/**
 * Filtros del agente → estado del catálogo, con las MISMAS reglas que la URL
 * (`leerEstado`): lo inválido se descarta (atributo desconocido, precio
 * negativo, orden raro). `in_stock_only: false` incluye los sin stock; sin el
 * campo, el default ("Solo con stock").
 */
export function estadoDeFiltros(f: CatalogFilters): EstadoCatalogo {
  return leerEstado({
    q: f.q,
    categoria: f.categories,
    marca: f.brands,
    atr: f.attributes,
    precio_min: f.price_min != null ? String(f.price_min) : undefined,
    precio_max: f.price_max != null ? String(f.price_max) : undefined,
    orden: f.sort,
    stock: f.in_stock_only === false ? STOCK_INCLUYE_SIN_STOCK : undefined,
  });
}

/** URL del catálogo para los filtros del agente (validados por catalogo-url). */
export function hrefDeFiltros(f: CatalogFilters): string {
  return hrefCatalogo(estadoDeFiltros(f));
}

/**
 * ¿Puede una card `catalog` en vivo navegar sola? Sólo si el visitante ya está
 * en el catálogo y ve el chat acoplado al lado: ve el cambio sin perder el
 * chat. Si no, la card muestra "Ver en el catálogo".
 */
export function puedeNavegarSolo(opts: { pathname: string; acoplado: boolean; abierto: boolean }): boolean {
  return opts.pathname.replace(/\/+$/, "") === "/catalogo" && opts.acoplado && opts.abierto;
}

/** Id del producto de la ficha (`/producto/[id]`), o `undefined` fuera de ella. */
export function idProductoDeRuta(pathname: string): string | undefined {
  const m = /^\/producto\/([^/?#]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : undefined;
}
