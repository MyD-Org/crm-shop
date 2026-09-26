// Mail de recuperación de contraseña del backoffice (POST /api/admin/auth/forgot-password).
//
// Módulo PURO (sin db, env ni red): arma el mail. El envío lo hace la ruta, vía `sendEmail`.

import { emailCardHtml, emailDocumentHtml, oneLine, saludo } from "@/lib/email-layout"

export interface ForgotPasswordEmailInput {
  tenantName: string
  /** URL del logo del tenant, ya validada con `safeLogoUrl`. Sin esto, la cabecera va en texto. */
  logoUrl?: string | null
  nombre: string
  /** Link absoluto a /admin/reset-password/{token}. */
  resetUrl: string
}

export function buildForgotPasswordEmail(input: ForgotPasswordEmailInput): { subject: string; html: string; text: string } {
  const saludoTexto = saludo(input.nombre)
  const titulo = "Recuperar contraseña"
  const cuerpo = "Recibimos una solicitud para restablecer su contraseña del backoffice."
  const vigencia = "El link vence en 1 hora. Si no la solicitó, ignore este mensaje."
  const subject = `${oneLine(input.tenantName)} — Recuperar contraseña`.slice(0, 200)

  const html = emailDocumentHtml(
    emailCardHtml({
      tenantName: input.tenantName,
      logoUrl: input.logoUrl,
      preheader: cuerpo,
      titulo,
      parrafos: [saludoTexto, cuerpo],
      pie: vigencia,
      boton: { url: input.resetUrl, texto: "Restablecer contraseña" },
    }),
    subject,
  )

  const text = [titulo, "", saludoTexto, cuerpo, "", `Restablecer contraseña: ${input.resetUrl}`, "", vigencia].join("\n")

  return { subject, html, text }
}
