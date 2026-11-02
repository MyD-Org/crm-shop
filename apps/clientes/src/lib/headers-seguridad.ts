/**
 * Headers de seguridad de todas las respuestas del Shop (`headers()` de
 * next.config.ts).
 *
 * Módulo PURO y sin alias `@/`: lo importa next.config.ts. Ningún host de
 * producción literal (el repo es público): lo propio de cada entorno sale de
 * las variables (Clerk, fotos, R2).
 *
 * La CSP se manda aplicada (`Content-Security-Policy`) o en Report-Only
 * (`Content-Security-Policy-Report-Only`, el navegador informa lo que
 * bloquearía pero no bloquea nada); lo decide `cspAplicada`: la variable
 * `CSP_APLICAR` si está, y si no, aplicada en los Preview de Vercel (rama
 * staging) y Report-Only en producción. Para pasarla en producción hay que
 * probarla antes en staging recorriendo login de Clerk, checkout con el Brick
 * de Mercado Pago y con Payway, Informar pago, fichas técnicas y el editor de
 * la home, mirando los reportes (consola del navegador y `/api/csp-report`).
 * Las políticas se evalúan en build (next.config.ts): cambiar `CSP_APLICAR`
 * exige un redeploy, sin cambio de código.
 *
 * `'unsafe-inline'` en script-src es deliberado: el layout inyecta el script de
 * tema en el <head> y Next mete los datos del RSC inline. La alternativa con
 * nonce exige render dinámico en cada request, incompatible con el shell
 * estático de Cache Components (PPR). Ver la guía de CSP de Next, "Without
 * Nonces".
 */

import { paywayParaCsp, type Entorno } from "./pagos/credenciales";

/** Variables que alimentan la CSP. Se inyectan para poder testear. */
export interface EnvCsp {
  NODE_ENV?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_CLERK_PROXY_URL?: string;
  SHOP_MEDIA_HOSTS?: string;
  R2_SHOP_MEDIA_PUBLIC_URL?: string;
  CSP_REPORT_URI?: string;
  /** "1"/"true"/"si" aplica la CSP; "0"/"false"/"no" la deja en Report-Only. Ver `cspAplicada`. */
  CSP_APLICAR?: string;
  /** Entorno de Vercel: `preview` (rama staging), `production`, `development`. */
  VERCEL_ENV?: string;
  META_PIXEL_ID?: string;
  GA4_MEASUREMENT_ID?: string;
}

export interface OpcionesCsp {
  /**
   * Política de las páginas de checkout: suma el host de la API de Payway a `connect-src` (el
   * formulario de tarjeta tokeniza desde el navegador, `POST {base}/api/v2/tokens`) y el script del SDK
   * oficial (`decidir.js`) a `script-src`. El formulario es propio (sin iframe de Payway); la huella de
   * Cybersource (`h.online-metrix.net`) entra en `script-src`, `frame-src`, `img-src` y `connect-src`.
   * El resto del sitio no lo recibe.
   */
  checkout?: boolean;
  /**
   * Origen de la API de Payway, o null si no hay ninguna cuenta Payway configurada. Por defecto lo
   * calcula `paywayParaCsp` (credenciales.ts, el único que lee esas variables) con el mismo entorno.
   * Sólo se usa con `checkout`.
   */
  payway?: { origen: string } | null;
}

/**
 * Host del Frontend API de Clerk, derivado de la publishable key
 * (`pk_test_` / `pk_live_` + base64 de `<host>$`). null si no hay key o no se
 * puede leer.
 */
export function hostFrontendClerk(publishableKey: string | undefined): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(publishableKey?.trim() ?? "");
  if (!m) return null;
  try {
    const host = Buffer.from(m[1], "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** Origen (`https://host`) de una URL, o null si no es una URL https válida. */
function origenHttps(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Hosts separados por coma → `https://host`, sin vacíos. */
function origenesDeHosts(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => /^[a-z0-9.*-]+$/i.test(h))
    .map((h) => `https://${h}`);
}

/** Host que sirve el SDK de front de Payway (`decidir.js`); ver `URL_SDK_PAYWAY` en pagos/payway-token.ts. */
const PAYWAY_SDK = "https://ventasonline.payway.com.ar";
/**
 * Huella de dispositivo de Cybersource (ThreatMetrix): el SDK de Payway carga
 * `https://h.online-metrix.net/fp/tags.js` (script), que a su vez arma un iframe, pide recursos
 * (imágenes, XHR) del mismo host y los reporta. Verificado en `decidir.js` v2.6.4 (`_addCSJs`): ése es el
 * único host de terceros que agrega. Sólo en las páginas de checkout.
 */
const CYBERSOURCE_FINGERPRINT = "https://h.online-metrix.net";

const MERCADO_PAGO = [
  "https://sdk.mercadopago.com",
  "https://*.mercadopago.com",
  // Dinero en cuenta: el flujo de la billetera vive en el dominio argentino (el Brick abre sus ventanas ahí).
  "https://*.mercadopago.com.ar",
  "https://*.mercadolibre.com",
  "https://*.mlstatic.com",
];

/**
 * Tracking (flag `tracking`, ver src/lib/tracking-flag.ts). Meta y GA4 entran
 * sólo si su ID está cargado; PostHog va por `/ingest` y Vercel Analytics y
 * Speed Insights por `/_vercel/*`, los dos en 'self'. En desarrollo el script
 * de Vercel Analytics sale de su CDN.
 */
const META_SCRIPT = "https://connect.facebook.net";
const META_PIXEL = "https://www.facebook.com";
const GTM = "https://www.googletagmanager.com";
const GA = ["https://*.google-analytics.com", "https://*.analytics.google.com"];
const VERCEL_SCRIPTS_DEV = "https://va.vercel-scripts.com";

/** Telemetría de Clerk (clerk-js la manda desde el navegador). */
const CLERK_TELEMETRY = "https://clerk-telemetry.com";

/** Destino por defecto de los reportes de violaciones (ruta propia que sólo loguea). */
export const RUTA_REPORTE_CSP = "/api/csp-report";

/** Turnstile: el captcha del sign-up de Clerk. */
const CLOUDFLARE_CHALLENGES = "https://challenges.cloudflare.com";

/** Arma la política. Sin duplicados y en orden estable. */
export function politicaCsp(env: EnvCsp = process.env as EnvCsp, opciones: OpcionesCsp = {}): string {
  const dev = env.NODE_ENV === "development";

  // Clerk: su Frontend API (derivada de la key) o, con proxy (`/__clerk`),
  // el mismo origen ('self'). Sin key, los hosts de desarrollo de Clerk.
  const fapi = hostFrontendClerk(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const proxyClerk = origenHttps(env.NEXT_PUBLIC_CLERK_PROXY_URL);
  const clerk = [
    fapi ? `https://${fapi}` : "https://*.clerk.accounts.dev",
    ...(proxyClerk ? [proxyClerk] : []),
  ];

  const medios: string[] = [
    ...origenesDeHosts(env.SHOP_MEDIA_HOSTS),
    ...(origenHttps(env.R2_SHOP_MEDIA_PUBLIC_URL) ? [origenHttps(env.R2_SHOP_MEDIA_PUBLIC_URL)!] : []),
  ];

  const datosPayway = opciones.payway !== undefined ? opciones.payway : paywayParaCsp(env as Entorno);
  const payway = opciones.checkout && datosPayway ? origenHttps(datosPayway.origen) : null;

  const meta = Boolean(env.META_PIXEL_ID?.trim());
  const ga4 = Boolean(env.GA4_MEASUREMENT_ID?.trim());

  const directivas: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []),
      ...clerk,
      CLOUDFLARE_CHALLENGES,
      ...MERCADO_PAGO,
      ...(payway ? [PAYWAY_SDK, CYBERSOURCE_FINGERPRINT] : []),
      ...(meta ? [META_SCRIPT] : []),
      ...(ga4 ? [GTM] : []),
      ...(dev ? [VERCEL_SCRIPTS_DEV] : []),
    ],
    // Clerk y el Brick inyectan estilos inline.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://img.clerk.com",
      // Miniaturas de los videos de YouTube de las páginas de marca (bloque "La empresa").
      "https://i.ytimg.com",
      ...medios,
      ...MERCADO_PAGO,
      ...(payway ? [CYBERSOURCE_FINGERPRINT] : []),
      ...(meta ? [META_PIXEL] : []),
      ...(ga4 ? [GTM, ...GA] : []),
    ],
    // next/font sirve las fuentes desde el mismo origen.
    "font-src": ["'self'", "data:", ...MERCADO_PAGO],
    "connect-src": [
      "'self'",
      ...clerk,
      CLERK_TELEMETRY,
      ...MERCADO_PAGO,
      // Subidas firmadas (comprobantes de pago, imágenes de la home) directo a R2.
      "https://*.r2.cloudflarestorage.com",
      ...(payway ? [payway, CYBERSOURCE_FINGERPRINT] : []),
      ...(meta ? [META_PIXEL, META_SCRIPT] : []),
      ...(ga4 ? [GTM, ...GA] : []),
      ...(dev ? ["ws:", VERCEL_SCRIPTS_DEV] : []),
    ],
    // Mapa del local (popup "Ver local"): embed de Google Maps sin clave.
    "frame-src": [
      "'self'",
      CLOUDFLARE_CHALLENGES,
      ...MERCADO_PAGO,
      "https://www.google.com",
      // Videos de las páginas de marca: se cargan recién al tocar "Reproducir".
      "https://www.youtube-nocookie.com",
      "https://player.vimeo.com",
      // Fichas técnicas: el PDF se muestra en un iframe (FichaTecnicaModal) servido desde los medios.
      ...medios,
      ...(payway ? [CYBERSOURCE_FINGERPRINT] : []),
    ],
    "worker-src": ["'self'", "blob:"],
    "form-action": ["'self'", ...MERCADO_PAGO],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    // Chrome aplica object-src al visor de PDF de un iframe: con 'none' la ficha técnica no se abre.
    "object-src": ["'self'", ...medios],
  };

  const partes = Object.entries(directivas).map(
    ([nombre, valores]) => `${nombre} ${[...new Set(valores)].join(" ")}`,
  );
  partes.push(`report-uri ${env.CSP_REPORT_URI?.trim() || RUTA_REPORTE_CSP}`);
  return partes.join("; ");
}

/**
 * ¿La CSP se manda aplicada? `CSP_APLICAR` manda si es un valor reconocido; sin ella, aplicada sólo
 * en los Preview de Vercel (staging) y Report-Only en producción y en local.
 */
export function cspAplicada(env: EnvCsp = process.env as EnvCsp): boolean {
  const v = env.CSP_APLICAR?.trim().toLowerCase();
  if (v && ["1", "true", "si", "sí", "on"].includes(v)) return true;
  if (v && ["0", "false", "no", "off"].includes(v)) return false;
  return env.VERCEL_ENV === "preview";
}

/** Headers para `headers()` de next.config.ts (todas las rutas). */
export function headersDeSeguridad(env: EnvCsp = process.env as EnvCsp, opciones: OpcionesCsp = {}) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // Nada del Shop usa cámara ni micrófono. La ubicación del navegador SÓLO la usa el propio sitio,
    // y sólo si el visitante toca "Usar mi ubicación" (pide permiso; ver /api/ubicacion): `self`,
    // nunca iframes de terceros. `payment` no se restringe: el Brick de Mercado Pago puede usar
    // Payment Request.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
    // Sin includeSubDomains ni preload: el dominio raíz puede tener subdominios
    // que no son del Shop y no se decide eso desde acá.
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
    {
      key: cspAplicada(env) ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
      value: politicaCsp(env, opciones),
    },
  ];
}
