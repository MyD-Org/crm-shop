import type { MetadataRoute } from "next";
import type { Marca } from "@/lib/marca-base";
import type { ColoresPwa } from "@/lib/tema-tenant";

/**
 * Manifest PWA de una marca. `name`: el mismo texto que `metadata.title` (`marca.titulo`);
 * `short_name`: el nombre.
 *
 * `display: "browser"`: no hay `apple-icon` ni un ícono PNG cuadrado propio todavía (sólo
 * `src/app/icon.svg`, servido por Next en `/icon.svg` — se verificó en `.next/server/app/` tras
 * `next build`, no en la doc genérica), así que no se promete instalación "standalone" con un
 * ícono que no está a la altura. Una marca con su propio ícono lo usa en el manifest.
 *
 * `background_color`/`theme_color`: tokens del tema `calido-azul` (el de por defecto,
 * `TEMA_POR_DEFECTO` en `src/lib/tema-ip.ts`) — `--color-bg` y `--color-primary` de
 * `src/app/globals.css`. Con paleta propia del tenant (`tenants.shop_tema`, `coloresPwaDeTema`) son
 * su `bg` y su `primary`.
 */
export function manifestDeMarca(marca: Marca, pwa: ColoresPwa | null = null): MetadataRoute.Manifest {
  const icono = marca.faviconUrl
    ? { src: marca.faviconUrl, sizes: "any", type: tipoImagen(marca.faviconUrl) }
    : { src: "/icon.svg", sizes: "any", type: "image/svg+xml" };
  return {
    name: marca.titulo,
    short_name: marca.nombre,
    description: marca.descripcionManifest,
    lang: "es-AR",
    start_url: "/",
    display: "browser",
    background_color: pwa?.fondo ?? "#f8f8f6",
    theme_color: pwa?.tema ?? "#16283f",
    icons: [icono],
  };
}

function tipoImagen(url: string): string {
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg") return "image/jpeg";
  return "image/svg+xml";
}
