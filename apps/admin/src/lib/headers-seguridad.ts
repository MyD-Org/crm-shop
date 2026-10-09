/**
 * Headers de seguridad de todas las respuestas del CRM (`headers()` de next.config.ts).
 *
 * Módulo PURO y sin alias `@/`: lo importa next.config.ts. Es el mismo juego que usa el Shop
 * (apps/clientes/src/lib/headers-seguridad.ts), sin CSP: el backoffice embebe el widget de chat
 * de ai-api y Sentry, y una CSP a ciegas puede romperlos sin error visible. Si se suma, que sea
 * primero en modo Report-Only, como hizo el Shop.
 *
 * `X-Frame-Options: SAMEORIGIN` y no DENY: el portal muestra los PDF de facturas en un <iframe>
 * del mismo origen (`/api/portal/documentos/...`); DENY también bloquea ese caso.
 */
export function headersDeSeguridad() {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    // Nada del CRM usa cámara, micrófono ni ubicación del navegador.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Sin includeSubDomains ni preload: el dominio raíz tiene subdominios que no son del CRM.
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
  ]
}
