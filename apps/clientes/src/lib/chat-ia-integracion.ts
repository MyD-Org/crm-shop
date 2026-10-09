/**
 * Integración del Shop con el chat del asistente (ai-widget 0.8.0, spec
 * catálogo asistido §6 y fase 2 §4): de los filtros que propone el agente a
 * una URL del catálogo, cuándo el chat se acopla a la derecha, cuándo es la
 * hoja mobile y cuándo puede navegar solo.
 * Módulo puro: lo usa ChatIaWidget.
 */
import type { CatalogFilters } from "@myd-org/ai-widget";
import {
  STOCK_INCLUYE_SIN_STOCK,
  estadoDeBusqueda,
  hrefCatalogo,
  leerEstado,
  type EstadoCatalogo,
} from "./catalogo-url";

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
 * Ancho por debajo del cual el chat es la hoja mobile a pantalla completa
 * (`mobileBreakpoint` del ChatDrawer). La media query es la misma que arma
 * el widget (`max-width: <breakpoint - 0.02>px`): los dos cambian juntos.
 */
export const BREAKPOINT_MOBILE = 768;
export const MEDIA_MOBILE = `(max-width: ${BREAKPOINT_MOBILE - 0.02}px)`;

/**
 * Atributo de `<html>` que marca la hoja mobile minimizada (barra "peek"
 * abajo): globals.css sube las barras de compra fijas de la ficha y el
 * carrito para que la barra del chat no las tape.
 */
export const ATRIBUTO_PEEK = "data-chat-peek";

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
 * en el catálogo y el chat está abierto de forma que ve el cambio sin perderlo:
 * - acoplado a la derecha (≥ 1280 px): el catálogo se actualiza al lado;
 * - hoja mobile (< 768 px), expandida o minimizada: la hoja pasa sola a la
 *   barra "peek" con "Filtros aplicados" y el catálogo queda a la vista.
 * En el medio (drawer flotante que tapa la grilla) o cerrado, la card muestra
 * "Ver en el catálogo".
 */
export function puedeNavegarSolo(opts: { pathname: string; acoplado: boolean; abierto: boolean; mobile?: boolean }): boolean {
  const enCatalogo = opts.pathname.replace(/\/+$/, "") === "/catalogo";
  return enCatalogo && opts.abierto && (opts.acoplado || opts.mobile === true);
}

/** ¿La hoja mobile está abierta y minimizada (barra "peek" abajo)? */
export function hojaMinimizada(opts: { mobile: boolean; abierto: boolean; presentacion: "expanded" | "peek" }): boolean {
  return opts.mobile && opts.abierto && opts.presentacion === "peek";
}

/** Id del producto de la ficha (`/producto/[id]`), o `undefined` fuera de ella. */
export function idProductoDeRuta(pathname: string): string | undefined {
  const m = /^\/producto\/([^/?#]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * ¿Dos URLs del Shop son la misma página del catálogo? Compara el estado que
 * codifican (el orden de los parámetros o `+`/`%20` no importan); fuera del
 * catálogo, el texto tal cual.
 */
export function mismaUrlCatalogo(a: string, b: string): boolean {
  const partir = (u: string) => {
    const [ruta, qs = ""] = u.split("?");
    return { ruta: ruta.replace(/\/+$/, "") || "/", qs };
  };
  const x = partir(a);
  const y = partir(b);
  if (x.ruta !== y.ruta) return false;
  if (x.ruta !== "/catalogo") return x.qs === y.qs;
  return hrefCatalogo(estadoDeBusqueda(new URLSearchParams(x.qs))) === hrefCatalogo(estadoDeBusqueda(new URLSearchParams(y.qs)));
}

/**
 * "Deshacer" de la card `catalog`: si el visitante sigue en la página a la que
 * navegó el agente, atrás en el historial (no deja una entrada de más); si ya
 * se movió, a la URL anterior.
 */
export function comoDeshacer(actual: string, destino: string): "atras" | "anterior" {
  return mismaUrlCatalogo(actual, destino) ? "atras" : "anterior";
}
