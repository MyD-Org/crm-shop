/**
 * Lo puro de `/marcas/[slug]` (spec 2026-10-20-marcas-tienda-oficial §2 y §5):
 * metadata, filtros del catálogo, estado de la URL y enlaces.
 */
import type { Metadata } from "next";
import type { FiltrosSinTexto } from "@/lib/catalog";
import { hrefMarca, type PaginaMarca } from "./pagina-marca";

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
 */
export function metadataMarca(p: PaginaMarca, nombreTienda: string, conQuery: boolean): Metadata {
  const titulo = tituloMarca(p, nombreTienda);
  const descripcion = p.seo?.descripcion ?? (p.bajada || undefined);
  const imagen = p.seo?.imagenOg ?? p.logo;
  return {
    title: { absolute: titulo },
    ...(descripcion ? { description: descripcion } : {}),
    alternates: { canonical: hrefMarca(p.slug) },
    openGraph: { title: titulo, ...(descripcion ? { description: descripcion } : {}), ...(imagen ? { images: [imagen] } : {}) },
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

/** Página `n` de resultados de la página de marca (con la línea vigente). */
export function hrefPaginaMarca(slug: string, n: number, linea?: string): string {
  const q = new URLSearchParams();
  if (linea) q.set("linea", linea);
  if (n > 1) q.set("pagina", String(n));
  const s = q.toString();
  return `${hrefMarca(slug)}${s ? `?${s}` : ""}#productos`;
}

/** El catálogo completo con todos los filtros, acotado a la marca. */
export function hrefCatalogoCompleto(p: PaginaMarca): string {
  const q = new URLSearchParams();
  for (const v of p.marcasCatalogo) q.append("marca", v);
  return `/catalogo?${q.toString()}`;
}

/** Rutas de marca para el sitemap: nada si no hay publicadas. */
export function rutasSitemapMarcas(ps: readonly PaginaMarca[]): string[] {
  const publicadas = ps.filter((p) => p.publicada);
  return publicadas.length ? ["/marcas", ...publicadas.map((p) => hrefMarca(p.slug))] : [];
}
