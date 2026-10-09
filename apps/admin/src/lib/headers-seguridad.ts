/**
 * Headers de seguridad de todas las respuestas del CRM (`headers()` de next.config.ts).
 *
 * Módulo PURO y sin alias `@/`: lo importa next.config.ts. Mismo diseño que el Shop
 * (apps/clientes/src/lib/headers-seguridad.ts). Ningún host de producción literal (el repo es
 * público): lo propio de cada entorno sale de las variables (Sentry, fotos del catálogo).
 *
 * CSP en modo REPORT-ONLY (`Content-Security-Policy-Report-Only`): el navegador informa lo que
 * bloquearía pero no bloquea nada. El paso a enforcing (`Content-Security-Policy`) se hace
 * DESPUÉS de mirar los reportes (consola del navegador, o el endpoint de `CSP_REPORT_URI` si está
 * cargado) recorriendo inbox con adjuntos, correo con imágenes, chat del portal, catálogo con
 * fotos, comprobantes y portal con PDF, y de sumar acá lo que haya faltado. Procedimiento en
 * docs/DEPLOY.md ("CSP"). Pasarla a enforcing a ciegas puede romper el login o el widget sin
 * error visible del lado del server.
 *
 * `'unsafe-inline'` en script-src es deliberado: el layout inyecta el script de tema en el <head>
 * y Next mete los datos del RSC inline. La alternativa con nonce exige render dinámico en cada
 * request. Ver la guía de CSP de Next, "Without Nonces".
 *
 * `X-Frame-Options: SAMEORIGIN` y `frame-ancestors 'self'`, no DENY/'none': el portal muestra los
 * PDF de facturas en un <iframe> del mismo origen (`/api/portal/documentos/...`).
 *
 * Inventario de orígenes (2026-10, grep en src y next.config.ts):
 * - Scripts: ninguno externo. Sentry (@sentry/nextjs) y el widget de chat (@myd-org/ai-widget,
 *   vendorizado) van en el bundle propio. El widget habla con ai-api por el rewrite same-origin
 *   `/ai-api/:path*` (next.config.ts), así que no hace falta el host de ai-api en connect-src.
 * - Estilos y fuentes: Google Fonts (`@import` de Bowlby One en globals.css): hoja desde
 *   fonts.googleapis.com, archivos desde fonts.gstatic.com. El resto es propio.
 * - Imágenes: logos de /public/logos, fotos del catálogo (origen de `R2_SHOP_MEDIA_PUBLIC_URL`,
 *   un bucket público), comprobantes de pago (el visor `/api/.../file` redirige 302 a una URL
 *   firmada de R2: la CSP evalúa el destino del redirect), adjuntos de WhatsApp del inbox (URL
 *   firmada de R2 que emite ai-api, mismo patrón `<cuenta>.r2.cloudflarestorage.com`) y previews
 *   locales (`blob:` de URL.createObjectURL, `data:`).
 * - Audio/video: adjuntos de WhatsApp del inbox (<audio>/<video> con URL firmada de R2).
 * - Fetch/XHR: APIs propias; subidas PUT prefirmadas directo a R2 (fotos del catálogo, ficha,
 *   imagen de categoría, adjuntos del correo, comprobantes del portal); Sentry (origen derivado
 *   de `NEXT_PUBLIC_SENTRY_DSN`; sin tunnel configurado).
 * - Iframes: PDF del portal (`blob:` armado tras un fetch same-origin), comprobantes PDF (302 a
 *   R2), cuerpo del correo (`srcdoc` sandbox; ver abajo). Nada de terceros.
 * - Workers: el service worker de Web Push (`/sw.js`, mismo origen).
 * - Forms: ninguno con `action` externo (el alta de WhatsApp redirige desde el server).
 */

/** Variables que alimentan la CSP. Se inyectan para poder testear. */
export interface EnvCsp {
  NODE_ENV?: string
  /** "preview" en los deploys de Preview de Vercel: ahí se admite la Toolbar de Vercel (vercel.live). */
  VERCEL_ENV?: string
  NEXT_PUBLIC_SENTRY_DSN?: string
  R2_SHOP_MEDIA_PUBLIC_URL?: string
  CSP_REPORT_URI?: string
}

export interface OpcionesCsp {
  /**
   * Política de Mensajes (`/admin/inbox`, donde el correo vive como solapas). El cuerpo de cada mensaje se muestra en
   * un <iframe sandbox srcdoc> (MensajeHtml.tsx) y los documentos `about:srcdoc` HEREDAN la CSP
   * del documento que los enmarca, además de la propia (`correo-srcdoc.ts`, que ya limita todo a
   * `img-src https: data:` cuando la persona pulsa "Mostrar imágenes"). Un correo trae imágenes de
   * cualquier host, así que en estas páginas `img-src` admite `https:`. El resto del CRM no.
   */
  correo?: boolean
}

/** Origen (`https://host`) de una URL, o null si no es una URL https válida. */
function origenHttps(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === "https:" ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Origen de ingesta de Sentry, derivado del DSN (`https://<clave>@<host>/<proyecto>`). `URL.origin`
 * descarta la clave pública. null si no hay DSN o no se puede leer.
 */
export function origenSentry(dsn: string | undefined): string | null {
  return origenHttps(dsn)
}

/**
 * Endpoints S3 de Cloudflare R2 (`<cuenta>.r2.cloudflarestorage.com`): URLs firmadas de lectura
 * (comprobantes, adjuntos del inbox que firma ai-api) y de subida (PUT prefirmados). La cuenta
 * vive en `R2_ACCOUNT_ID`/`R2_SHOP_MEDIA_ACCOUNT_ID`, pero el comodín evita atar la CSP a una
 * cuenta puntual y cubre también la de ai-api.
 */
const R2 = "https://*.r2.cloudflarestorage.com"

/**
 * Toolbar de Vercel en los deploys de Preview (comentarios, flags): inyecta su script, un iframe y
 * pide a vercel.live. Sólo con `VERCEL_ENV=preview`; en producción no se carga y no se admite.
 */
const VERCEL_TOOLBAR = "https://vercel.live"

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com"
const GOOGLE_FONTS_ARCHIVOS = "https://fonts.gstatic.com"

/** Arma la política. Sin duplicados y en orden estable. */
export function politicaCsp(env: EnvCsp = process.env as EnvCsp, opciones: OpcionesCsp = {}): string {
  const dev = env.NODE_ENV === "development"
  const preview = env.VERCEL_ENV === "preview"
  const sentry = origenSentry(env.NEXT_PUBLIC_SENTRY_DSN)
  const fotos = origenHttps(env.R2_SHOP_MEDIA_PUBLIC_URL)

  const directivas: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...(preview ? [VERCEL_TOOLBAR] : [])],
    // El DS y el widget inyectan estilos inline; Google Fonts sirve la hoja de Bowlby One.
    "style-src": ["'self'", "'unsafe-inline'", GOOGLE_FONTS_CSS],
    "img-src": ["'self'", "data:", "blob:", R2, ...(fotos ? [fotos] : []), ...(opciones.correo ? ["https:"] : [])],
    "font-src": ["'self'", "data:", GOOGLE_FONTS_ARCHIVOS],
    // Adjuntos de audio/video del inbox (URL firmada de R2).
    "media-src": ["'self'", "blob:", R2],
    "connect-src": ["'self'", R2, ...(sentry ? [sentry] : []), ...(dev ? ["ws:"] : []), ...(preview ? [VERCEL_TOOLBAR] : [])],
    // PDF del portal (blob:) y comprobantes PDF (302 a R2).
    "frame-src": ["'self'", "blob:", R2, ...(preview ? [VERCEL_TOOLBAR] : [])],
    "worker-src": ["'self'", "blob:"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  }

  const partes = Object.entries(directivas).map(([nombre, valores]) => `${nombre} ${[...new Set(valores)].join(" ")}`)
  const reporte = env.CSP_REPORT_URI?.trim()
  if (reporte) partes.push(`report-uri ${reporte}`)
  return partes.join("; ")
}

/** Headers para `headers()` de next.config.ts (todas las rutas). */
export function headersDeSeguridad(env: EnvCsp = process.env as EnvCsp, opciones: OpcionesCsp = {}) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    // Nada del CRM usa cámara, micrófono ni ubicación del navegador.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Sin includeSubDomains ni preload: el dominio raíz tiene subdominios que no son del CRM.
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
    { key: "Content-Security-Policy-Report-Only", value: politicaCsp(env, opciones) },
  ]
}
