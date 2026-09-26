// Layout HTML común de los mails del CRM (pedidos, factura, OTP, cobranza, recuperar
// contraseña, invitación al backoffice): tarjeta blanca con borde superior de color, montada
// con tablas y estilos inline. Es lo único que renderiza parejo en todos los clientes de mail
// (Outlook de escritorio usa el motor de Word: ignora flex, grid y border-radius, pero
// respeta las tablas y degrada sin romperse).
//
// Módulo PURO (sin db, env ni red): sólo arma strings de HTML/texto.
//
// El comprobante de pago a la empresa (`receipt-email.ts`) NO usa este layout: es una
// notificación interna con una grilla de datos (cliente/CUIT/monto/…) en vez de una tarjeta de
// "aviso al cliente", así que tiene su propia maqueta. Si en algún momento se le agrega
// preheader o el `<meta charset>` de `emailDocumentHtml`, hacerlo ahí también.

/** Escape HTML completo (& < > " ') para todo dato dinámico que entra a un mail. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** CR/LF y controles ⇒ espacio (asuntos y nombres que van a un mail: defensa contra header injection). */
export function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
}

/** "Hola, Ana:" o "Hola:" si no hay nombre. */
export function saludo(nombre: string): string {
  const n = nombre.trim()
  return n ? `Hola, ${n}:` : "Hola:"
}

/**
 * Texto invisible que Gmail/Outlook/Apple Mail muestran junto al asunto en la bandeja de
 * entrada, antes de que el mail se abra. Sin esto, el preview cae en la primera línea visible
 * del HTML (a veces basura tipo "Ver este mail en el navegador").
 */
function preheaderHtml(texto: string): string {
  return `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${escapeHtml(texto)}</div>`
}

/**
 * `tenant.logoPath` listo para la cabecera del mail, o null si no corresponde mostrarlo.
 *
 * Sólo pasa si es una URL ABSOLUTA (con esquema http/https) a un archivo `.png`/`.jpg`/`.jpeg`:
 *   - Relativa (el default de todo tenant hoy es `/logos/{id}.svg`, ver tenants.ts) no sirve en
 *     un mail: no hay documento del que "colgarla", así que resolvería contra el cliente de
 *     mail del destinatario, no contra el CRM.
 *   - SVG y WebP no rinden en Gmail/Outlook (los bloquean o no los decodifican): un logo en
 *     esos formatos se vería como el ícono de imagen rota, peor que no mostrar nada.
 * HOY ningún tenant configura un logo absoluto en ese formato (todos usan el default relativo
 * `.svg`), así que esto no cambia nada visible todavía — queda listo para cuando alguno lo
 * configure. (En el Shop hubo un caso análogo con un gate que devolvía HTML en vez de la
 * imagen; acá no aplica: el matcher del proxy excluye `logos/` explícitamente, ver proxy.ts.)
 */
export function safeLogoUrl(logoPath: string | null | undefined): string | null {
  if (!logoPath) return null
  let url: URL
  try {
    url = new URL(logoPath)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!/\.(png|jpe?g)$/i.test(url.pathname)) return null
  return logoPath
}

export interface EmailCardInput {
  tenantName: string
  /** URL del logo (ya validada con `safeLogoUrl`). Sin esto, la cabecera muestra el nombre en texto. */
  logoUrl?: string | null
  /** Preview del mail en la bandeja de entrada. Sin esto, no hay preheader. */
  preheader?: string
  /** Título en negrita arriba del cuerpo. Sin título, el cuerpo arranca directo en `parrafos`/`contenidoHtml`. */
  titulo?: string
  /** Párrafos de texto plano: se escapan acá y se renderizan uno debajo del otro. */
  parrafos?: string[]
  /**
   * HTML ya armado (tablas, `<strong>`, etc.) para insertar entre los párrafos y el pie.
   * A diferencia de `parrafos`, esto NO se escapa: quien lo arma es responsable de escapar
   * cada dato dinámico que ponga ahí.
   */
  contenidoHtml?: string
  /** Línea gris chica al pie, DENTRO de la tarjeta. */
  pie?: string
  boton?: { url: string; texto: string } | null
  /** Línea gris chica DEBAJO de la tarjeta (fuera del borde blanco), ej. "Portal de clientes de X". */
  footerExterno?: string
}

/** Tarjeta blanca con el encabezado del tenant, título, cuerpo, pie y botón opcional. */
export function emailCardHtml(input: EmailCardInput): string {
  const e = escapeHtml
  const boton = input.boton
    ? `<p style="margin:24px 0 0"><a href="${e(input.boton.url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${e(input.boton.texto)}</a></p>`
    : ""
  const titulo = input.titulo ? `<p style="margin:0 0 16px;font-size:18px;font-weight:700">${e(input.titulo)}</p>` : ""
  const parrafos = (input.parrafos ?? []).map((p) => `\n        <p style="margin:0 0 12px">${e(p)}</p>`).join("")
  const pie = input.pie ? `<p style="margin:0;color:#6b7280;font-size:14px">${e(input.pie)}</p>` : ""
  const footerExterno = input.footerExterno
    ? `\n    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;color:#9ca3af;padding:16px 0 0;text-align:center">${e(input.footerExterno)}</div>`
    : ""

  return `${input.preheader ? preheaderHtml(input.preheader) : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef1f5;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;border-top:3px solid #1f8cff">
      <tr><td style="padding:28px 32px 0">
        ${
          input.logoUrl
            ? `<img src="${e(input.logoUrl)}" alt="${e(input.tenantName)}" height="28" style="display:block;height:28px;max-width:200px;border:0" />`
            : `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280">${e(input.tenantName)}</div>`
        }
      </td></tr>
      <tr><td style="padding:20px 32px 28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#111827">
        ${titulo}${parrafos}${input.contenidoHtml ?? ""}
        ${pie}${boton}
      </td></tr>
    </table>${footerExterno}
  </td></tr>
</table>`
}

/**
 * Envuelve el HTML del mail en un documento completo: `<meta charset>` (sin esto, un cliente
 * de mail que no adivine bien la codificación rompe acentos y "ñ"), viewport, y
 * `color-scheme`/`supported-color-schemes` en "light" para que Gmail/Outlook no le aplique al
 * mail su propio modo oscuro (los colores de la tarjeta son fijos: sin esto, un dark mode
 * automático puede invertir el fondo blanco a negro y dejar texto negro sobre negro).
 */
export function emailDocumentHtml(bodyHtml: string, titulo?: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">${titulo ? `\n<title>${escapeHtml(titulo)}</title>` : ""}
</head>
<body style="margin:0;padding:0;background:#eef1f5">${bodyHtml}
</body>
</html>`
}
