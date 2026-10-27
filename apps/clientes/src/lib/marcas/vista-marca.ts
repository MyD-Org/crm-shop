/**
 * Lo puro de `/marcas/[slug]` (spec 2026-10-20-marcas-tienda-oficial §2 y §5):
 * metadata, filtros del catálogo, estado de la URL y enlaces.
 */
import type { Metadata } from "next";
import type { FiltrosSinTexto } from "@/lib/catalog";
import { enlaceWhatsapp } from "@/lib/contacto-pedido";
import { IMAGEN_SITIO, openGraphDelSitio } from "@/lib/metadata-marca";
import { hrefMarca, type CotizacionMarca, type PaginaMarca } from "./pagina-marca";

export { videoEmbebible, type VideoEmbebible } from "./video";

type Params = Record<string, string | string[] | undefined>;

const primero = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function tituloMarca(p: PaginaMarca, nombreTienda: string): string {
  if (p.seo?.titulo) return p.seo.titulo;
  return p.nivel === "oficial" ? `${p.nombre} — Tienda oficial | ${nombreTienda}` : `${p.nombre} | ${nombreTienda}`;
}

/**
 * Título absoluto (no pasa por la plantilla del layout), descripción, OG y
 * canonical a la página sin query. Con query (línea o página de resultados):
 * `noindex, follow`, para no indexar variantes de la misma página.
 *
 * El `openGraph` de la página reemplaza entero al del layout: sin imagen propia ni
 * logo va la general del sitio (si no, el link se comparte sin imagen), y repite
 * `og:site_name` y `og:locale` (`openGraphDelSitio`).
 */
export function metadataMarca(p: PaginaMarca, nombreTienda: string, conQuery: boolean): Metadata {
  const titulo = tituloMarca(p, nombreTienda);
  const descripcion = p.seo?.descripcion ?? (p.bajada || undefined);
  // Canonical e imagen relativos sólo con la base del sitio (como `/catalogo` y la ficha): sin
  // `NEXT_PUBLIC_SITE_URL` un canonical relativo rompe el build y uno a localhost es peor que nada.
  const conBase = Boolean(process.env.NEXT_PUBLIC_SITE_URL);
  const imagen = conBase ? (p.seo?.imagenOg ?? p.logo ?? IMAGEN_SITIO) : undefined;
  return {
    title: { absolute: titulo },
    ...(descripcion ? { description: descripcion } : {}),
    ...(conBase ? { alternates: { canonical: hrefMarca(p.slug) } } : {}),
    openGraph: {
      ...openGraphDelSitio(nombreTienda),
      title: titulo,
      ...(descripcion ? { description: descripcion } : {}),
      ...(imagen ? { images: [imagen] } : {}),
    },
    ...(conQuery ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Filtros del catálogo de una página: los valores crudos de la marca (sin
 * `mostrar_marca`) y, si viene, la línea. Nunca `soloStock`: la página muestra
 * la línea completa (decisión de Emanuel, spec §5).
 */
export function filtrosDeMarca(p: PaginaMarca, lineaSlug?: string): FiltrosSinTexto {
  const linea = lineaSlug ? p.bloques.lineas?.items.find((l) => l.slug === lineaSlug) : undefined;
  return {
    marcasPropias: p.marcasCatalogo,
    ...(linea ? { linea: { categorias: linea.categorias, skus: linea.skus } } : {}),
  };
}

/** Página (1-based, ≥ 1) y línea (solo si existe en la página). */
export function leerEstadoMarca(params: Params, p: PaginaMarca): { pagina: number; linea?: string } {
  const n = Number.parseInt(primero(params.pagina) ?? "", 10);
  const pagina = Number.isFinite(n) && n >= 1 ? n : 1;
  const linea = primero(params.linea);
  return linea && p.bloques.lineas?.items.some((l) => l.slug === linea) ? { pagina, linea } : { pagina };
}

export function hrefLinea(slug: string, linea?: string): string {
  return linea ? `${hrefMarca(slug)}?linea=${encodeURIComponent(linea)}#productos` : `${hrefMarca(slug)}#productos`;
}

/** Rutas de marca para el sitemap: cada página publicada (no hay índice `/marcas`). */
export function rutasSitemapMarcas(ps: readonly PaginaMarca[]): string[] {
  return ps.filter((p) => p.publicada).map((p) => hrefMarca(p.slug));
}

/**
 * A dónde lleva "Pedir cotización de obra": el enlace del bloque, o WhatsApp con el número propio
 * del bloque (si no, el de la tienda) y el mensaje precargado. `null` = no hay destino válido y el
 * bloque no se dibuja.
 */
export function hrefCotizacion(c: CotizacionMarca, whatsappTienda: string | null | undefined): string | null {
  if (c.destino === "enlace") return c.href ?? null;
  return enlaceWhatsapp(c.whatsapp || whatsappTienda, c.mensaje);
}
