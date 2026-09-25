/**
 * robots.txt y sitemap.xml del Shop (src/app/robots.ts, src/app/sitemap.ts).
 *
 * Módulo puro: recibe la URL del sitio y los ids ya leídos, así se testea sin
 * base ni request. Las dos cosas necesitan URLs absolutas y el repo no lleva
 * el dominio: salen de `NEXT_PUBLIC_SITE_URL` (el mismo `metadataBase` del
 * layout). Sin la variable, robots omite el sitemap y el sitemap sale vacío.
 */
import type { MetadataRoute } from "next";

/**
 * Páginas públicas fijas que vale la pena indexar. El catálogo filtrado y la
 * ficha de cada producto entran aparte (los productos, por id).
 */
export const PAGINAS_PUBLICAS = [
  "/",
  "/catalogo",
  "/envios-y-pagos",
  "/terminos",
  "/privacidad",
  "/arrepentimiento",
] as const;

/**
 * Rutas que no tienen nada que indexar: son del visitante (carrito, cuenta,
 * checkout), de login, o APIs. Disallow no las protege (eso lo hace el auth);
 * sólo evita que los buscadores gasten crawl en ellas.
 */
export const RUTAS_PRIVADAS = [
  "/api/",
  "/carrito",
  "/checkout",
  "/mi-cuenta",
  "/ingresar",
  "/registro",
  "/__gate",
] as const;

/** URL base sin la barra final, o null si no hay una válida. */
export function baseDelSitio(sitio: string | undefined): string | null {
  if (!sitio?.trim()) return null;
  try {
    return new URL(sitio).origin;
  } catch {
    return null;
  }
}

export function reglasRobots(sitio: string | undefined): MetadataRoute.Robots {
  const base = baseDelSitio(sitio);
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...RUTAS_PRIVADAS] },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}

export function entradasSitemap(
  sitio: string | undefined,
  idsProductos: readonly string[],
): MetadataRoute.Sitemap {
  const base = baseDelSitio(sitio);
  if (!base) return [];
  return [
    ...PAGINAS_PUBLICAS.map((ruta) => ({
      url: `${base}${ruta === "/" ? "" : ruta}`,
      changeFrequency: ruta === "/" || ruta === "/catalogo" ? ("daily" as const) : ("monthly" as const),
      priority: ruta === "/" ? 1 : ruta === "/catalogo" ? 0.9 : 0.3,
    })),
    ...idsProductos.map((id) => ({
      url: `${base}/producto/${encodeURIComponent(id)}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
