/**
 * Mail con el código para vincular la cuenta de cliente.
 *
 * Mismo esqueleto que el mail de comprobantes (`comprobantes/mail.ts`: tarjeta
 * de 440px, franja arriba, nombre de la tienda como sobretítulo), pero con los
 * colores del tema azul de la tienda (`[data-theme="calido-azul"]` en
 * globals.css): lo recibe el cliente, no el backoffice. Se renderiza en clientes de correo: tablas y
 * estilos inline, fuera del DS.
 *
 * Decisiones:
 *  - El código es lo único que la persona viene a buscar: va grande, en una
 *    caja propia, con cifras tabulares y separado en dos grupos de 3 para
 *    leerlo y tipearlo sin perderse. En el texto plano y el asunto va entero,
 *    sin espacio, para que el autocompletado del celular lo tome.
 *  - Preheader oculto con el código y el vencimiento: es lo que se ve en la
 *    bandeja sin abrir el mail.
 *  - "Cuenta de cliente" y no "cuenta corriente": el mail también les llega a
 *    los clientes de contado.
 */

import { escapeHtml } from "./escape-html";

export interface MailCodigoVinculacion {
  subject: string;
  html: string;
  text: string;
}

const FUENTE = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

/** "123456" → "123 456". Otros largos quedan como vienen. */
function agrupar(codigo: string): string {
  return /^\d{6}$/.test(codigo) ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo;
}

/** Ruta del logo para mails: PNG (Gmail y Outlook no muestran SVG), a 2x de 180×23. */
export const RUTA_LOGO_MAIL = "/images/central-led/logo-mail.png";

/**
 * URL absoluta del logo, o null sin `NEXT_PUBLIC_SITE_URL`: un mail no puede
 * usar rutas relativas, y la URL de producción no va escrita en el repo.
 */
export function urlLogoMail(sitio = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  if (!sitio) return null;
  try {
    return new URL(RUTA_LOGO_MAIL, sitio).toString();
  } catch {
    return null;
  }
}

export function armarMailCodigoVinculacion(input: {
  codigo: string;
  vigenciaMin: number;
  tienda: string;
  /** null = sin logo: va el nombre de la tienda en texto, como antes. */
  logoUrl?: string | null;
}): MailCodigoVinculacion {
  const e = escapeHtml;
  const { codigo, vigenciaMin, tienda, logoUrl } = input;
  const vence = `Vence en ${vigenciaMin} minutos.`;
  const aviso = "Si no lo pidió, ignore este mensaje: nadie puede acceder a su cuenta sin este código.";

  const subject = `${codigo} es su código para vincular su cuenta`;

  const html = `
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Su código es ${e(codigo)}. ${e(vence)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8f8f6;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;border-top:3px solid #1e5aa8">
      <tr><td style="padding:28px 32px 0">
        ${
          logoUrl
            ? `<img src="${e(logoUrl)}" width="180" height="23" alt="${e(tienda)}" style="display:block;border:0;outline:none;text-decoration:none;height:23px;width:180px;font-family:${FUENTE};font-size:16px;font-weight:700;color:#1e5aa8">`
            : `<div style="font-family:${FUENTE};font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1e5aa8">${e(tienda)}</div>`
        }
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE};color:#1c2733">
        <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:700">Vincule su cuenta</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#77808a">Use este código para asociar su cuenta de cliente a su usuario de la tienda.</p>
      </td></tr>
      <tr><td style="padding:24px 32px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#e9f1fa;border:1px solid #d3e2f4;border-radius:10px">
          <tr><td align="center" style="padding:20px 16px 18px">
            <div style="font-family:${FUENTE};font-size:34px;line-height:1;font-weight:700;letter-spacing:0.12em;color:#16283f;font-variant-numeric:tabular-nums;white-space:nowrap">${e(agrupar(codigo))}</div>
            <div style="font-family:${FUENTE};font-size:13px;line-height:1.4;color:#77808a;margin-top:12px">${e(vence)}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 32px 28px;font-family:${FUENTE};font-size:12px;line-height:1.55;color:#a8b0b9">
        <p style="margin:0">${e(aviso)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = [
    `Su código para vincular su cuenta en la tienda de ${tienda} es ${codigo}.`,
    vence,
    ``,
    aviso,
  ].join("\n");

  return { subject, html, text };
}
