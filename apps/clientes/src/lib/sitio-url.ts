/**
 * URL canónica del sitio vs. URL del propio host.
 *
 * Con dos proyectos Vercel sirviendo la misma tienda, el secundario declara
 * `NEXT_PUBLIC_CANONICAL_URL` (opcional) apuntando al principal: canonicals,
 * `metadataBase`, JSON-LD y sitemap salen con esa base. `NEXT_PUBLIC_SITE_URL`
 * sigue siendo el host propio (mails, redirects, recursos). Sin CANONICAL todo
 * se comporta como antes.
 */
import { baseDelSitio } from "./seo";

/** Origin de la CANONICAL si es https (http solo en localhost); si no, null. */
function baseCanonica(canonical: string | undefined): string | null {
  const base = baseDelSitio(canonical);
  if (!base) return null;
  const { protocol, hostname } = new URL(base);
  if (protocol === "https:") return base;
  if (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")) {
    return base;
  }
  return null;
}

/** Base para canonicals y sitemap: CANONICAL válida, si no SITE, si no undefined. */
export function urlCanonicaBase(canonical?: string, site?: string): string | undefined {
  return baseCanonica(canonical) ?? baseDelSitio(site) ?? undefined;
}

/** true si hay CANONICAL válida y apunta a otro origin que SITE. */
export function esSitioSecundario(canonical?: string, site?: string): boolean {
  const c = baseCanonica(canonical);
  const s = baseDelSitio(site);
  return Boolean(c && s && c !== s);
}

/**
 * Lee las variables LITERALMENTE (`process.env.NEXT_PUBLIC_*`) para que Next las
 * inlinee en el bundle del cliente.
 */
export function urlCanonicaDelSitio(): string | undefined {
  return urlCanonicaBase(process.env.NEXT_PUBLIC_CANONICAL_URL, process.env.NEXT_PUBLIC_SITE_URL);
}

export function esSitioSecundarioDelEntorno(): boolean {
  return esSitioSecundario(process.env.NEXT_PUBLIC_CANONICAL_URL, process.env.NEXT_PUBLIC_SITE_URL);
}
