import type { NextConfig } from "next";
import { hostsDeMedios } from "./src/lib/catalogo-medios";
import { REDIRECTS_MI_CUENTA } from "./src/lib/mi-cuenta-redirects";
import { normalizarUrlAiApi } from "./src/lib/ai-api-config";

const nextConfig: NextConfig = {
  experimental: {
    // El caché de filesystem de Turbopack (beta, on por defecto en Next 16.1+)
    // se corrompe y rompe el dev con errores "SST file" / build-manifest ENOENT.
    // Lo desactivamos hasta que sea estable.
    turbopackFileSystemCacheForDev: false,
  },
  // Comprobantes de pago: HEIC/HEIF → JPEG con heic-decode (WASM de
  // libheif-js) y sharp (binario nativo). Se cargan desde node_modules en
  // runtime en vez de empaquetarse (sharp ya está en la lista automática de
  // Next; se nombra igual para que quede explícito).
  serverExternalPackages: ["sharp", "heic-decode", "libheif-js"],
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
  // Chat con el agente: el widget habla con ai-api por el mismo origen (sin
  // CORS). Sólo existe si AI_API_URL está definida; que el chat se muestre lo
  // decide el flag `chat-ia` (src/lib/chat-ia-flag.ts), no esta regla.
  rewrites: async () => {
    const aiApi = normalizarUrlAiApi(process.env.AI_API_URL);
    return aiApi ? [{ source: "/ai-api/:path*", destination: `${aiApi}/:path*` }] : [];
  },
};

export default nextConfig;
