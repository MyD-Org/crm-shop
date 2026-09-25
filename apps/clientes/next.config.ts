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
    // Plan Hobby: cada variante (ancho × calidad × formato) que no está en
    // caché cuenta como una transformación de la cuota mensual. Por eso una
    // sola calidad y anchos acotados: las fuentes miden 1600 px como máximo,
    // más ancho sería transformar para nada. `formats` queda en el default
    // (sólo WebP) y `imageSizes` también.
    qualities: [75],
    deviceSizes: [640, 828, 1080, 1280, 1600],
    // 31 días: las claves de R2 llevan uuid y no cambian de contenido.
    // Ojo con `public/images`: el optimizador guarda la variante 31 días por
    // ruta. Si se reemplaza un archivo ahí, cambiarle el nombre (o invalidar
    // con `vercel cache invalidate --srcimg <ruta>`); si no, se sigue viendo
    // la versión vieja.
    minimumCacheTTL: 2678400,
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
  // La misma lista de hosts, inlineada en el bundle del cliente para
  // `imagenNext` (src/components/catalogo/imagen-next.tsx): decide si una URL
  // va por el optimizador o por un <img> común. Se evalúa en build, igual que
  // remotePatterns: cambiar SHOP_MEDIA_HOSTS exige redeploy.
  env: { HOSTS_IMAGENES: hostsDeMedios().join(",") },
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
