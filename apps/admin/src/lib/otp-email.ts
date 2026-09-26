import { emailCardHtml, emailDocumentHtml, escapeHtml, safeLogoUrl } from "@/lib/email-layout"
import type { TenantConfig } from "@/lib/tenants"

// Formato pensado para que el celular ofrezca "Copiar código" desde la notificación,
// sin abrir el mail. No hay estándar para email (el `@dominio #código` es solo de SMS):
// iOS y Gmail lo detectan por heurística, así que el mail cumple lo que esa heurística
// busca — el código en el asunto, la frase "código de verificación" pegada al número,
// los 6 dígitos SIN separadores ni espaciado que los parta, y una parte en texto plano
// (`text`), que es la que suelen parsear. Si se cambia la redacción, mantener la frase
// "Su código de verificación es NNNNNN" literal en el texto plano y el número en el asunto.
//
// NO agregar un botón de "copiar código": los clientes de mail no ejecutan JavaScript
// (Gmail, Outlook y Apple Mail lo bloquean), así que sería un botón muerto. Lo más
// cercano que funciona es un link al portal, evaluado y descartado por ahora.
export function buildOtpEmail(tenant: TenantConfig, razonsocial: string, otp: string) {
  const e = escapeHtml
  const nombre = razonsocial.trim()
  const subject = `${otp} es su código de verificación de ${tenant.name}`

  const contenidoHtml = `
        <p style="margin:0 0 4px">Hola${nombre ? ` ${e(nombre)}` : ""},</p>
        <p style="margin:0 0 20px">Su código de verificación es:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f8fb;border:1px solid #e5e7eb;border-radius:8px">
          <tr><td align="center" style="padding:18px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:700;color:#111827">${e(otp)}</td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:13px;color:#6b7280">Vence en 10 minutos y sirve una sola vez.</p>
        <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #eef1f5;font-size:13px;color:#6b7280">Si no solicitó este código, ignore este mensaje: sin él nadie puede entrar a su cuenta.</p>`

  return {
    subject,
    text:
      `Su código de verificación es ${otp}\n\n` +
      `Hola ${razonsocial}: use este código para entrar al portal de clientes de ${tenant.name}. ` +
      `Vence en 10 minutos y sirve una sola vez.\n\n` +
      `Si no solicitó este código, ignore este mensaje: sin él nadie puede entrar a su cuenta.`,
    // Maquetado con tablas y estilos inline: es lo único que renderiza parejo en todos los
    // clientes de mail (Outlook de escritorio usa el motor de Word — ignora flex, grid y
    // border-radius, pero respeta las tablas y degrada sin romperse).
    html: emailDocumentHtml(
      emailCardHtml({
        tenantName: tenant.name,
        logoUrl: safeLogoUrl(tenant.logoPath),
        preheader: `Su código de verificación es ${otp}`,
        contenidoHtml,
        footerExterno: `Portal de clientes de ${tenant.name}`,
      }),
      subject,
    ),
  }
}
