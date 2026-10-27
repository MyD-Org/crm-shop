import type { Metadata } from "next";
import { ICONOS_CENTRAL, esMarcaCentral, type Marca } from "@/lib/marca-base";

/** Ruta de la imagen general del sitio (src/app/opengraph-image.tsx). */
export const IMAGEN_SITIO = "/opengraph-image";

/**
 * Lo de Open Graph que comparte todo el sitio (`og:type`, `og:site_name`, `og:locale`). Next
 * mezcla el metadata de los segmentos en forma SUPERFICIAL: una página que declara su `openGraph`
 * reemplaza entero al del layout. Por eso la ficha y las páginas de marca lo vuelven a poner
 * con esto. Sin `url`: en el layout la heredarían todas las páginas como si fueran la home.
 */
export function openGraphDelSitio(nombreTienda: string) {
  return { type: "website" as const, siteName: nombreTienda, locale: "es_AR" };
}

/**
 * `metadata` del layout raíz para una marca. Con la marca de Central es el objeto de siempre
 * (caracterizado en `metadata-marca.test.ts`). Puro: el layout le pasa lo que lee del entorno.
 *
 * `icons` sólo si la marca trae su ícono: sin él rige `src/app/icon.svg` (convención de archivo de
 * Next), que es el de Central y no cambia de URL. La tienda de Central declara sus íconos acá
 * (`.ico` de respaldo, el SVG y el PNG de iOS) y no como `app/apple-icon.png`, para que no los
 * herede otra marca. Ojo: con `icons` en el metadata Next deja de emitir el `<link>` de
 * `app/icon.svg`, por eso el SVG va en la lista.
 */
export function metadataDeMarca(
  marca: Marca,
  entorno: { siteUrl?: string; facebookToken?: string },
): Metadata {
  return {
    // Base de las URLs absolutas de metadata (canonical). Por entorno: el repo no lleva el
    // dominio. Sin la variable, las páginas omiten el canonical.
    metadataBase: entorno.siteUrl ? new URL(entorno.siteUrl) : undefined,
    title: marca.titulo,
    description: marca.descripcion,
    // La imagen la agrega src/app/opengraph-image.tsx (convención de archivo, con prioridad).
    openGraph: openGraphDelSitio(marca.nombre),
    ...(marca.faviconUrl
      ? { icons: { icon: marca.faviconUrl } }
      : esMarcaCentral(marca)
        ? {
            icons: {
              icon: [
                { url: ICONOS_CENTRAL.ico, sizes: "48x48" },
                { url: ICONOS_CENTRAL.svg, type: "image/svg+xml" },
              ],
              apple: ICONOS_CENTRAL.apple,
            },
          }
        : {}),
    // Verificación del dominio en Meta: el token es de la cuenta de la tienda y va por entorno
    // (repo público). Sin la variable no se emite el meta.
    ...(entorno.facebookToken
      ? { verification: { other: { "facebook-domain-verification": entorno.facebookToken } } }
      : {}),
  };
}
