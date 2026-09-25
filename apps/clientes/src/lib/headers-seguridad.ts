/**
 * Headers de seguridad de todas las respuestas del Shop (`headers()` de
 * next.config.ts).
 *
 * Módulo PURO y sin alias `@/`: lo importa next.config.ts. Ningún host de
 * producción literal (el repo es público): lo propio de cada entorno sale de
 * las variables (Clerk, fotos, R2).
 *
 * CSP en modo REPORT-ONLY (`Content-Security-Policy-Report-Only`): el navegador
 * informa lo que bloquearía pero no bloquea nada. El paso a enforcing
 * (`Content-Security-Policy`) se hace DESPUÉS de mirar los reportes (consola
 * del navegador, o el endpoint de `CSP_REPORT_URI` si está cargado) recorriendo
 * login de Clerk, checkout con el Brick de Mercado Pago, Informar pago y el
 * editor de la home, y de sumar acá lo que haya faltado. Pasarla a enforcing a
 * ciegas puede romper el pago o el login sin error visible del lado del server.
 *
 * `'unsafe-inline'` en script-src es deliberado: el layout inyecta el script de
 * tema en el <head> y Next mete los datos del RSC inline. La alternativa con
 * nonce exige render dinámico en cada request, incompatible con el shell
 * estático de Cache Components (PPR). Ver la guía de CSP de Next, "Without
 * Nonces".
 */

/** Variables que alimentan la CSP. Se inyectan para poder testear. */
export interface EnvCsp {
  NODE_ENV?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_CLERK_PROXY_URL?: string;
  SHOP_MEDIA_HOSTS?: string;
  R2_SHOP_MEDIA_PUBLIC_URL?: string;
  CSP_REPORT_URI?: string;
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

const MERCADO_PAGO = [
  "https://sdk.mercadopago.com",
  "https://*.mercadopago.com",
  "https://*.mercadolibre.com",
  "https://*.mlstatic.com",
];

/** Turnstile: el captcha del sign-up de Clerk. */
const CLOUDFLARE_CHALLENGES = "https://challenges.cloudflare.com";

/** Arma la política. Sin duplicados y en orden estable. */
export function politicaCsp(env: EnvCsp = process.env as EnvCsp): string {
  const dev = env.NODE_ENV === "development";

  // Clerk: su Frontend API (derivada de la key) o, con proxy (`/__clerk`),
  // el mismo origen ('self'). Sin key, los hosts de desarrollo de Clerk.
  const fapi = hostFrontendClerk(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const proxyClerk = origenHttps(env.NEXT_PUBLIC_CLERK_PROXY_URL);
  const clerk = [
    fapi ? `https://${fapi}` : "https://*.clerk.accounts.dev",
    ...(proxyClerk ? [proxyClerk] : []),
  ];

  const medios = [
    ...origenesDeHosts(env.SHOP_MEDIA_HOSTS),
    ...(origenHttps(env.R2_SHOP_MEDIA_PUBLIC_URL) ? [origenHttps(env.R2_SHOP_MEDIA_PUBLIC_URL)!] : []),
  ];

  const directivas: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []),
      ...clerk,
      CLOUDFLARE_CHALLENGES,
      ...MERCADO_PAGO,
    ],
    // Clerk y el Brick inyectan estilos inline.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://img.clerk.com",
      ...medios,
      ...MERCADO_PAGO,
    ],
    // next/font sirve las fuentes desde el mismo origen.
    "font-src": ["'self'", "data:", ...MERCADO_PAGO],
    "connect-src": [
      "'self'",
      ...clerk,
      ...MERCADO_PAGO,
      // Subidas firmadas (comprobantes de pago, imágenes de la home) directo a R2.
      "https://*.r2.cloudflarestorage.com",
      ...(dev ? ["ws:"] : []),
    ],
    "frame-src": ["'self'", CLOUDFLARE_CHALLENGES, ...MERCADO_PAGO],
    "worker-src": ["'self'", "blob:"],
    "form-action": ["'self'", ...MERCADO_PAGO],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };

  const partes = Object.entries(directivas).map(
    ([nombre, valores]) => `${nombre} ${[...new Set(valores)].join(" ")}`,
  );
  const reporte = env.CSP_REPORT_URI?.trim();
  if (reporte) partes.push(`report-uri ${reporte}`);
  return partes.join("; ");
}

/** Headers para `headers()` de next.config.ts (todas las rutas). */
export function headersDeSeguridad(env: EnvCsp = process.env as EnvCsp) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // Nada del Shop usa cámara, micrófono ni la ubicación del navegador (la
    // dirección de envío se geocodifica en el server, /api/geocode). `payment`
    // no se restringe: el Brick de Mercado Pago puede usar Payment Request.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Sin includeSubDomains ni preload: el dominio raíz puede tener subdominios
    // que no son del Shop y no se decide eso desde acá.
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
    { key: "Content-Security-Policy-Report-Only", value: politicaCsp(env) },
  ];
}
