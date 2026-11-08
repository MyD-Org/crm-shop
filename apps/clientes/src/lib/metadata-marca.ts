import type { Metadata } from "next";
import { baseDelSitio } from "@/lib/seo";
import { ICONOS_CENTRAL, ICONO_NEUTRO, type Marca } from "@/lib/marca-base";

/** Ruta de la imagen general del sitio (src/app/imagen-para-compartir/route.tsx). */
export const RUTA_IMAGEN_SITIO = "/imagen-para-compartir";
export const IMAGEN_SITIO_ANCHO = 1200;
export const IMAGEN_SITIO_ALTO = 630;
/** Neutro: sale en el HTML de todas las marcas, así que no nombra a ninguna. */
export const IMAGEN_SITIO_ALT = "Vista previa de la tienda";

/**
 * URL ABSOLUTA de la imagen general del sitio, siempre con el origen PROPIO (`NEXT_PUBLIC_SITE_URL`)
 * y nunca con el de `metadataBase`: en el sitio secundario ése es el canónico (el del principal) y
 * la imagen saldría dibujada por el otro proyecto, con la marca del otro. Sin la variable (o
 * inválida), `undefined`: no se manda imagen.
 */
export function urlImagenDelSitio(sitio: string | undefined): string | undefined {
  const base = baseDelSitio(sitio);
  return base ? `${base}${RUTA_IMAGEN_SITIO}` : undefined;
}

/**
 * Lo de Open Graph que comparte todo el sitio (`og:type`, `og:site_name`, `og:locale`). Next
 * mezcla el metadata de los segmentos en forma SUPERFICIAL: una página que declara su `openGraph`
 * reemplaza entero al del layout. Por eso la ficha y las páginas de marca lo vuelven a poner
 * con esto. Sin `url`: en el layout la heredarían todas las páginas como si fueran la home.
 */
export function openGraphDelSitio(nombreTienda: string) {
  return { type: "website" as const, siteName: nombreTienda, locale: "es_AR" };
}

/** A dónde redirige `/favicon.ico` (src/app/favicon.ico/route.ts) para una marca. */
export function destinoFavicon(marca: Pick<Marca, "faviconUrl" | "recursosCentral">): string {
  if (marca.faviconUrl) return marca.faviconUrl;
  return marca.recursosCentral ? ICONOS_CENTRAL.ico : ICONO_NEUTRO;
}

/**
 * `metadata` del layout raíz para una marca. Con la marca de Central es el objeto de siempre
 * (caracterizado en `metadata-marca.test.ts`). Puro: el layout le pasa lo que lee del entorno.
 *
 * `icons` SIEMPRE se declara, nunca por convención de archivo (un `app/icon.svg` lo heredaría
 * cualquier marca): el ícono propio de la marca; si no, y sólo si es la tienda de Central
 * (`recursosCentral`), los de Central (`.ico` de respaldo, el SVG y el PNG de iOS, en
 * public/images/central-led/); si no, un ícono neutro sin marca.
 */
export function metadataDeMarca(
  marca: Marca,
  entorno: { siteUrl?: string; propioUrl?: string; facebookToken?: string; googleToken?: string },
): Metadata {
  const google = entorno.googleToken?.trim()
  const verification = {
    ...(google ? { google } : {}),
    ...(entorno.facebookToken ? { other: { "facebook-domain-verification": entorno.facebookToken } } : {}),
  }
  return {
    // Base de las URLs absolutas de metadata (canonical). Por entorno: el repo no lleva el
    // dominio. Sin la variable, las páginas omiten el canonical.
    metadataBase: entorno.siteUrl ? new URL(entorno.siteUrl) : undefined,
    title: marca.titulo,
    description: marca.descripcion,
    // La imagen va absoluta y con el origen PROPIO (`propioUrl`), no con `metadataBase` (canónico).
    // La dibuja src/app/imagen-para-compartir/route.tsx. Sin `propioUrl`, no se manda imagen.
    openGraph: {
      ...openGraphDelSitio(marca.nombre),
      ...(urlImagenDelSitio(entorno.propioUrl)
        ? {
            images: [
              {
                url: urlImagenDelSitio(entorno.propioUrl)!,
                width: IMAGEN_SITIO_ANCHO,
                height: IMAGEN_SITIO_ALTO,
                alt: IMAGEN_SITIO_ALT,
              },
            ],
          }
        : {}),
    },
    icons: marca.faviconUrl
      ? { icon: marca.faviconUrl }
      : marca.recursosCentral
        ? {
            icon: [
              { url: ICONOS_CENTRAL.ico, sizes: "48x48" },
              { url: ICONOS_CENTRAL.svg, type: "image/svg+xml" },
            ],
            apple: ICONOS_CENTRAL.apple,
          }
        : { icon: [{ url: ICONO_NEUTRO, type: "image/svg+xml" }] },
    // Verificación del dominio en Meta y en Google Search Console: los tokens son de las cuentas de
    // la tienda y van por entorno (repo público). Sin variables no se emite ningún meta. La de Google
    // sirve cuando el DNS del dominio no está a mano (verificación por "etiqueta HTML").
    ...(Object.keys(verification).length > 0 ? { verification } : {}),
  };
}
