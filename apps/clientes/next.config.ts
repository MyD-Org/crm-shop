import type { NextConfig } from "next";
import { hostsDeMedios } from "./src/lib/catalogo-medios";
import { REDIRECTS_MI_CUENTA } from "./src/lib/mi-cuenta-redirects";

const nextConfig: NextConfig = {
  experimental: {
    // El caché de filesystem de Turbopack (beta, on por defecto en Next 16.1+)
    // se corrompe y rompe el dev con errores "SST file" / build-manifest ENOENT.
    // Lo desactivamos hasta que sea estable.
    turbopackFileSystemCacheForDev: false,
  },
  images: {
    // Fotos del overlay del CRM: sólo los hosts de SHOP_MEDIA_HOSTS (separados
    // por coma). Sin la variable la lista queda vacía y las cards muestran el
    // placeholder (mapFilaToProduct descarta las fotos de hosts no listados).
    // Ningún host literal acá: el repo es público.
    remotePatterns: hostsDeMedios().map((hostname) => ({
      protocol: "https" as const,
      hostname,
      pathname: "/**",
    })),
  },
  // URLs viejas de Mi cuenta (pestañas y detalle en singular) a las rutas por
  // sección. Se resuelven antes que el filesystem: no se renderiza nada.
  redirects: async () => [...REDIRECTS_MI_CUENTA],
};

export default nextConfig;
