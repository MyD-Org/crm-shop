import type { MetadataRoute } from "next";
import { ICONOS_CENTRAL, ICONO_NEUTRO, type Marca } from "@/lib/marca-base";
import type { ColoresPwa } from "@/lib/tema-tenant";

/**
 * Manifest PWA de una marca. `name`: el mismo texto que `metadata.title` (`marca.titulo`);
 * `short_name`: el nombre.
 *
 * Íconos: el de la marca; la tienda de Central (`recursosCentral`) usa los suyos (SVG, PNG de 192
 * y 512 y el "maskable", `ICONOS_CENTRAL`); cualquier otra sin ícono, el neutro sin marca.
 *
 * `display: "browser"`: el sitio no se ofrece como app instalable ("standalone"); los PNG sirven
 * para el acceso directo de Android.
 *
 * `background_color`/`theme_color`: tokens del tema `calido-azul` (el de por defecto,
 * `TEMA_POR_DEFECTO` en `src/lib/tema-ip.ts`) — `--color-bg` y `--color-primary` de
 * `src/app/globals.css`. Con paleta propia del tenant (`tenants.shop_tema`, `coloresPwaDeTema`) son
 * su `bg` y su `primary`.
 */
export function manifestDeMarca(marca: Marca, pwa: ColoresPwa | null = null): MetadataRoute.Manifest {
  const iconos: MetadataRoute.Manifest["icons"] = marca.faviconUrl
    ? [{ src: marca.faviconUrl, sizes: "any", type: tipoImagen(marca.faviconUrl) }]
    : marca.recursosCentral
      ? [
          { src: ICONOS_CENTRAL.svg, sizes: "any", type: "image/svg+xml" },
          { src: ICONOS_CENTRAL.pwa192, sizes: "192x192", type: "image/png" },
          { src: ICONOS_CENTRAL.pwa512, sizes: "512x512", type: "image/png" },
          { src: ICONOS_CENTRAL.maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [{ src: ICONO_NEUTRO, sizes: "any", type: "image/svg+xml" }];
  return {
    name: marca.titulo,
    short_name: marca.nombre,
    description: marca.descripcionManifest,
    lang: "es-AR",
    start_url: "/",
    display: "browser",
    background_color: pwa?.fondo ?? "#f8f8f6",
    theme_color: pwa?.tema ?? "#16283f",
    icons: iconos,
  };
}

function tipoImagen(url: string): string {
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg") return "image/jpeg";
  return "image/svg+xml";
}
