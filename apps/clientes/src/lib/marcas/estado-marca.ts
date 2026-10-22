/**
 * Filtros del catálogo dentro de una página de marca (`/marcas/<slug>`). Es el mismo
 * `EstadoCatalogo` de `/catalogo` (categoría, precio, características, orden, vista, página), con
 * tres diferencias:
 * - nunca lleva marca (la fija la página) ni búsqueda por texto;
 * - "Solo con stock" arranca APAGADO (la tienda de la marca muestra la línea completa, spec §5) y
 *   se prende con `?stock=solo`;
 * - suma `?linea=` (las líneas de la página).
 * Módulo puro: lo usan la página (servidor) y los filtros (navegador).
 */
import { hrefCatalogo, leerEstado, type EstadoCatalogo } from "@/lib/catalogo-url";

type Params = Record<string, string | string[] | undefined>;

const STOCK_SOLO = "solo";
const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function estadoCatalogoDeMarca(params: Params): EstadoCatalogo {
  // Marca, búsqueda e `ia` no se leen: `leerEstado` los trae y acá se pisan.
  return { ...leerEstado(params), marcas: [], query: undefined, ia: undefined, soloStock: primero(params.stock) === STOCK_SOLO };
}

/** La URL de la página de la marca con estos filtros (y la línea), en un orden fijo. */
export function hrefMarcaConEstado(slug: string, estado: EstadoCatalogo, linea?: string): string {
  // El orden y la forma de cada parámetro son los de `/catalogo`; sólo cambia cómo se escribe el stock.
  const deCatalogo = new URL(
    hrefCatalogo({ ...estado, marcas: [], query: undefined, ia: undefined, soloStock: true }),
    "https://x.example",
  ).searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of deCatalogo) {
    if (k === "pagina") continue;
    sp.append(k, v);
  }
  if (estado.soloStock) sp.set("stock", STOCK_SOLO);
  if (estado.pagina > 1) sp.set("pagina", String(estado.pagina));
  if (linea) sp.set("linea", linea);
  const qs = sp.toString();
  return `/marcas/${slug}${qs ? `?${qs}` : ""}`;
}

/** Traduce un href de `/catalogo` (lo arma la hoja de filtros de mobile) a la página de la marca. */
export function hrefMarcaDesdeCatalogo(slug: string, href: string, linea?: string): string {
  const params: Params = {};
  for (const [k, v] of new URL(href, "https://x.example").searchParams) {
    const previo = params[k];
    params[k] = previo === undefined ? v : [...(Array.isArray(previo) ? previo : [previo]), v];
  }
  return hrefMarcaConEstado(slug, leerEstado(params), linea);
}
