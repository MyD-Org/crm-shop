/**
 * Sitio donde corre este despliegue. PURO: sin base ni caché.
 *
 * Una empresa puede servir la misma tienda desde más de un dominio, cada uno con su proyecto de
 * Vercel. El dominio principal es `tenants.shop_url`; los demás están en
 * `tenants.shop_destinos_extra` (`[{etiqueta, url, marca?, tema?, remitente?}]`). Un extra SIN
 * marca es un alias del principal (misma marca y contenido); con marca propia es un sitio propio.
 *
 * El sitio sale SIEMPRE del entorno del despliegue (`NEXT_PUBLIC_SITE_URL`), nunca del header
 * Host: así el shell sigue siendo estático. `SHOP_SITIO` (etiqueta) fuerza un sitio y sólo rige
 * fuera de producción (Preview/staging, cuyo host no coincide con ninguna URL).
 */
import { normalizarOrigenSitio } from "@/lib/sitio-origen";

export interface SitioResuelto {
  /** Etiqueta del sitio propio; null = principal o alias. */
  etiqueta: string | null;
  /** true = marca propia: no hereda nada del principal. */
  propio: boolean;
  marca?: unknown;
  tema?: unknown;
  remitente?: string;
}

const PRINCIPAL: SitioResuelto = { etiqueta: null, propio: false };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ExtraLegible {
  etiqueta: string;
  origen: string;
  marca: unknown;
  tema: unknown;
  remitente?: string;
}

function esObjetoNoVacio(v: unknown): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
}

function leerExtras(crudo: unknown): ExtraLegible[] {
  if (!Array.isArray(crudo)) return [];
  const salida: ExtraLegible[] = [];
  for (const e of crudo) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.etiqueta !== "string" || typeof o.url !== "string") continue;
    const origen = normalizarOrigenSitio(o.url);
    if (!origen) continue;
    const remitente = typeof o.remitente === "string" && EMAIL_RE.test(o.remitente.trim()) ? o.remitente.trim() : undefined;
    salida.push({ etiqueta: o.etiqueta, origen, marca: o.marca, tema: o.tema, remitente });
  }
  return salida;
}

function comoSitio(e: ExtraLegible): SitioResuelto {
  if (!esObjetoNoVacio(e.marca)) return PRINCIPAL;
  return {
    etiqueta: e.etiqueta,
    propio: true,
    marca: e.marca,
    ...(e.tema !== undefined ? { tema: e.tema } : {}),
    ...(e.remitente ? { remitente: e.remitente } : {}),
  };
}

/** Sitio de un despliegue: el override por etiqueta gana; si no, el extra cuya URL coincide. */
export function resolverSitio(siteUrl: string | undefined, extrasCrudo: unknown, override?: string): SitioResuelto {
  const extras = leerExtras(extrasCrudo);
  if (override) {
    const porEtiqueta = extras.find((e) => e.etiqueta === override);
    if (porEtiqueta) return comoSitio(porEtiqueta);
  }
  const origen = normalizarOrigenSitio(siteUrl);
  if (!origen) return PRINCIPAL;
  const e = extras.find((x) => x.origen === origen);
  return e ? comoSitio(e) : PRINCIPAL;
}

/**
 * Clave del sitio para las funciones `'use cache'`: viaja como argumento, así que entra en la
 * clave de caché. Se arma sólo con el entorno: origen + override ("origen|etiqueta").
 */
export function claveSitio(
  env: Record<string, string | undefined> = process.env,
): string {
  const origen = normalizarOrigenSitio(env.NEXT_PUBLIC_SITE_URL) ?? "";
  const override = env.VERCEL_ENV === "production" ? "" : (env.SHOP_SITIO?.trim() ?? "");
  return `${origen}|${override}`;
}

/** Resuelve el sitio desde una clave de `claveSitio`. */
export function resolverSitioPorClave(clave: string, extrasCrudo: unknown): SitioResuelto {
  const i = clave.indexOf("|");
  const origen = i >= 0 ? clave.slice(0, i) : clave;
  const override = i >= 0 ? clave.slice(i + 1) : "";
  return resolverSitio(origen || undefined, extrasCrudo, override || undefined);
}
