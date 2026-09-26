import type { MetadataRoute } from "next";

/**
 * Manifest PWA básico. `name`/`short_name`: mismo texto que `metadata.title`
 * en `src/app/layout.tsx` (no hay una constante compartida hoy, ver el mismo
 * criterio en `src/lib/sitio-jsonld.ts`).
 *
 * `display: "browser"`: no hay `apple-icon` ni un ícono PNG cuadrado propio
 * todavía (sólo `src/app/icon.svg`, servido por Next en `/icon.svg` — se
 * verificó en `.next/server/app/` tras `next build`, no en la doc genérica),
 * así que no se promete instalación "standalone" con un ícono que no está a
 * la altura.
 *
 * `background_color`/`theme_color`: tokens del tema `calido-azul` (el de por
 * defecto, `TEMA_POR_DEFECTO` en `src/lib/tema-ip.ts`) — `--color-bg` y
 * `--color-primary` de `src/app/globals.css`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Central LED — Tienda Online",
    short_name: "Central LED",
    description:
      "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones.",
    lang: "es-AR",
    start_url: "/",
    display: "browser",
    background_color: "#f8f8f6",
    theme_color: "#16283f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
