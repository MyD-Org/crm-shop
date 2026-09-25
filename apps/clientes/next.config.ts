import type { NextConfig } from "next";
import { hostsDeMedios } from "./src/lib/catalogo-medios";
import { REDIRECTS_MI_CUENTA } from "./src/lib/mi-cuenta-redirects";
import { normalizarUrlAiApi } from "./src/lib/ai-api-config";
import { headersDeSeguridad } from "./src/lib/headers-seguridad";

const nextConfig: NextConfig = {
  // Shell estático + huecos por request (Partial Prerendering). Lo que depende
  // del visitante (identidad, favoritos, carrito, chat, flags) se resuelve
  // dentro de <Suspense>; el contenido de la home (home_content) sale de
  // `'use cache'` con el tag `home` (src/lib/cache-tags.ts) y se invalida con
  // `updateTag` desde el editor. Ver src/lib/home-datos.ts. Los datos públicos
  // del catálogo y la oferta de cuotas que leen los huecos salen de
  // `'use cache: remote'` (src/lib/catalogo-publico.ts, src/lib/cuotas-datos.ts).
  cacheComponents: true,
  cacheLife: {
    // Contenido de la home: sólo cambia por el editor (updateTag), así que la
    // vida es larga; revalidate diario por si algo se escapa.
    home: { stale: 300, revalidate: 86400, expire: 2592000 },
    // Rama de error (defaults o vacío): nunca guardar un fallback por horas.
    // expire no baja de 300: una caché que vence en menos de 5 minutos queda
    // fuera del prerender (hueco dinámico) y el shell que la lee sin Suspense
    // (anuncio, footer) rompería el build o la revalidación si la base falla.
    degradado: { stale: 30, revalidate: 60, expire: 300 },
    // Catálogo (listado, facetas, ficha, nav y destacados): lo renueva el
    // aviso del CRM al terminar la sync o un drenaje de stock con cambios
    // (revalidateTag del tag `catalogo`). expire 900 = TTL de seguridad de
    // 15 minutos por si ese aviso se pierde; revalidate 600 lo refresca en
    // segundo plano con tráfico.
    catalogo: { stale: 60, revalidate: 600, expire: 900 },
    // Oferta de cuotas: la renuevan el ping del CRM y el cron (tag `cuotas`).
    cuotas: { stale: 300, revalidate: 900, expire: 3600 },
  },
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
  // Headers de seguridad en todas las respuestas. La CSP va en Report-Only:
  // el paso a enforcing se hace después de mirar los reportes (ver
  // src/lib/headers-seguridad.ts). Se evalúa en build: cambiar las variables
  // que la alimentan exige redeploy.
  headers: async () => [{ source: "/:path*", headers: headersDeSeguridad() }],
  // Chat con el agente: el widget habla con ai-api por el mismo origen (sin
  // CORS). Sólo existe si AI_API_URL está definida; que el chat se muestre lo
  // decide el flag `chat-ia` (src/lib/chat-ia-flag.ts), no esta regla.
  rewrites: async () => {
    const aiApi = normalizarUrlAiApi(process.env.AI_API_URL);
    return aiApi ? [{ source: "/ai-api/:path*", destination: `${aiApi}/:path*` }] : [];
  },
};

export default nextConfig;
