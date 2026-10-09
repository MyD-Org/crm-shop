import type { NextConfig } from "next";
import { headersDeSeguridad } from "./src/lib/headers-seguridad";

const nextConfig: NextConfig = {
  // Headers de seguridad en todas las respuestas (nosniff, referrer, frame, HSTS y CSP en modo
  // Report-Only: ver src/lib/headers-seguridad.ts). Se evalúa en build: cambiar las variables
  // que alimentan la CSP (Sentry, fotos, report-uri) requiere redeploy.
  // Mensajes (/admin/inbox, donde vive el correo como solapas) lleva además `img-src https:`:
  // los mensajes traen imágenes de cualquier host y el iframe srcdoc hereda esta CSP. Con dos
  // reglas que coinciden, el último header gana.
  headers: async () => [
    { source: "/:path*", headers: headersDeSeguridad() },
    { source: "/admin/inbox/:path*", headers: headersDeSeguridad(undefined, { correo: true }) },
  ],
  // sharp ya está en la lista automática de Next; heic-decode/libheif-js no: se excluyen del
  // bundling de Server Components para que carguen su wasm/binario con require nativo.
  serverExternalPackages: ["heic-decode", "libheif-js"],
  experimental: {
    // Client Cache: desde Next 15 el default de `dynamic` es 0s, o sea que entrar y salir de
    // un chat vuelve a pedirle TODO el inbox al server cada vez. Con 30s el "volver" sale de
    // cache y es instantáneo. Es seguro acá porque las dos vistas se refrescan solas: la lista
    // pollea cada 10s (InboxList) y el thread también (ContactThreadView), así que si algo
    // quedó viejo se corrige en el próximo tick sin que el operador haga nada.
    staleTimes: { dynamic: 30 },
  },
  images: {
    // Los logos de tenant (ej. /logos/central-led.svg) son SVG. next/image bloquea
    // los SVG en el optimizador por defecto; los habilitamos con una CSP restrictiva
    // (sin scripts, sandbox) porque son assets propios y confiables de /public/logos.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async rewrites() {
    // El widget de chat habla con ai-api vía same-origin para evitar CORS
    const aiApiUrl = process.env.CENTRAL_LED_AI_API_URL
    if (!aiApiUrl) return []
    return [{ source: "/ai-api/:path*", destination: `${aiApiUrl}/:path*` }]
  },
};

export default nextConfig;
