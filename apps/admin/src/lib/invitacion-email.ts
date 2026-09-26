// Mail de invitación al backoffice. Builder único: antes vivía duplicado (texto y todo) en
// POST /api/admin/usuarios y en POST /api/admin/usuarios/[id]/resend-invite.
//
// Módulo PURO (sin db, env ni red): arma el mail. El envío lo hace cada ruta, vía `sendEmail`.

import { emailCardHtml, emailDocumentHtml, escapeHtml, oneLine, saludo } from "@/lib/email-layout"

/** Etiqueta visible del rol en el mail de invitación. */
export function roleLabel(role: string): string {
  if (role === "superadmin") return "Superadmin"
  if (role === "admin") return "Admin"
  return "Operador"
}

export interface InvitacionEmailInput {
  tenantName: string
  /** URL del logo del tenant, ya validada con `safeLogoUrl`. Sin esto, la cabecera va en texto. */
  logoUrl?: string | null
  nombre: string
  role: string
  /** Link absoluto a /admin/reset-password/{token}. */
  inviteUrl: string
}

export function buildInvitacionEmail(input: InvitacionEmailInput): { subject: string; html: string; text: string } {
  const e = escapeHtml
  const tenantName = oneLine(input.tenantName)
  const saludoTexto = saludo(input.nombre)
  const rol = roleLabel(input.role)
  const titulo = "Invitación al backoffice"
  const cuerpo = `Fue invitado como <strong>${e(rol)}</strong> del backoffice.`
  const cuerpoPlano = `Fue invitado como ${rol} del backoffice.`
  const vigencia = "El link vence en 7 días."
  const subject = `Invitación al backoffice de ${tenantName}`.slice(0, 200)

  const html = emailDocumentHtml(
    emailCardHtml({
      tenantName,
      logoUrl: input.logoUrl,
      preheader: cuerpoPlano,
      titulo,
      contenidoHtml: `\n        <p style="margin:0 0 12px">${e(saludoTexto)}</p>\n        <p style="margin:0 0 12px">${cuerpo}</p>`,
      pie: vigencia,
      boton: { url: input.inviteUrl, texto: "Aceptar invitación y crear contraseña" },
    }),
    subject,
  )

  const text = [
    titulo,
    "",
    saludoTexto,
    cuerpoPlano,
    "",
    `Aceptar invitación y crear contraseña: ${input.inviteUrl}`,
    "",
    vigencia,
  ].join("\n")

  return { subject, html, text }
}
