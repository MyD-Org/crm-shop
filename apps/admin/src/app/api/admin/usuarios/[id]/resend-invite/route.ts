import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, adminPasswordTokens, tenants } from "@/db/schema"
import { generateToken } from "@/lib/admin-crypto"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { canActOnRole, canManageUsers } from "@/lib/roles"
import { sendEmail } from "@/lib/email"
import { safeLogoUrl } from "@/lib/email-layout"
import { buildInvitacionEmail } from "@/lib/invitacion-email"
import { EMPTY_TENANT, tenantConfigFromRow } from "@/lib/tenants"

// POST /api/admin/usuarios/:id/resend-invite
// Genera un token nuevo (invalida el anterior) y reintenta el envío del email.
// El inviteUrl (con el token crudo) se devuelve siempre para que quien gestiona usuarios
// copie el link a mano desde la UI mientras no haya servidor de mail configurado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response
  if (!canManageUsers(guard.user.role)) {
    return NextResponse.json({ error: "No tiene permisos de gestión de usuarios" }, { status: 403 })
  }

  const { id } = await params
  const db = getDb()

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.id, id), eq(adminUsers.tenantId, guard.tenantId)))
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  // Un admin solo puede reenviar invitaciones de operadores (no de admins/superadmins).
  if (!canActOnRole(guard.user.role, user.role)) {
    return NextResponse.json({ error: "No tiene permisos sobre este usuario" }, { status: 403 })
  }
  if (user.passwordHash) return NextResponse.json({ error: "El usuario ya activó su cuenta" }, { status: 409 })

  // Invalida tokens anteriores y genera uno nuevo
  await db.delete(adminPasswordTokens).where(
    and(eq(adminPasswordTokens.userId, user.id), eq(adminPasswordTokens.type, "invite")),
  )

  const { token, tokenHash } = generateToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await db.insert(adminPasswordTokens).values({ userId: user.id, tokenHash, type: "invite", expiresAt })

  // Base URL: preferimos derivarla del request (funciona en prod/preview/local sin
  // configurar nada); NEXT_PUBLIC_BASE_URL queda como override opcional.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? req.nextUrl.origin
  const inviteUrl = `${baseUrl}/admin/reset-password/${token}`

  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, guard.tenantId))
  const tenant = tenantRow ? tenantConfigFromRow(tenantRow) : EMPTY_TENANT

  let emailSent = true
  let emailError: string | undefined
  try {
    const { subject, html, text } = buildInvitacionEmail({
      tenantName: tenant.name,
      logoUrl: safeLogoUrl(tenant.logoPath),
      nombre: user.name,
      role: user.role,
      inviteUrl,
    })
    emailSent = await sendEmail(tenant, user.email, subject, html, text)
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err)
    console.error("[resend-invite] no se pudo enviar el mail:", emailError)
    emailSent = false
  }

  // Devolvemos el inviteUrl siempre (también en prod): mientras no haya servidor de
  // mail configurado, el superadmin copia el link desde la UI y lo comparte a mano.
  return NextResponse.json({ ok: true, emailSent, emailError, expiresAt, inviteUrl })
}
