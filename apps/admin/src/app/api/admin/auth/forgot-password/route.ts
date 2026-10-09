import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, adminPasswordTokens, tenants } from "@/db/schema"
import { generateToken } from "@/lib/admin-crypto"
import { sendEmail } from "@/lib/email"
import { safeLogoUrl } from "@/lib/email-layout"
import { buildForgotPasswordEmail } from "@/lib/forgot-password-email"
import { EMPTY_TENANT, tenantConfigFromRow } from "@/lib/tenants"
import { ipDe, permitir, respuestaLimite } from "@/lib/rate-limit"

// Endpoint anónimo que dispara un mail: sin límite es un generador de spam contra los usuarios
// del CRM. Por IP (429 visible) y por email (silencioso: la respuesta sigue siendo { ok: true }
// para no decir si la cuenta existe; simplemente no sale otro mail). Contador por proceso.
const MAX_POR_IP = 10
const MAX_POR_EMAIL = 3
const VENTANA_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  if (!permitir(`forgot-password:ip:${ipDe(req)}`, MAX_POR_IP, VENTANA_MS)) return respuestaLimite()
  const body = await req.json().catch(() => null)
  if (typeof body?.email !== "string" || !body.email) {
    return NextResponse.json({ error: "email requerido" }, { status: 400 })
  }
  const email = body.email.trim().toLowerCase()
  if (!permitir(`forgot-password:email:${email}`, MAX_POR_EMAIL, VENTANA_MS)) return NextResponse.json({ ok: true })

  const db = getDb()
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email))

  // Siempre responder OK para no filtrar si el email existe
  if (!user || !user.passwordHash) return NextResponse.json({ ok: true })

  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId))
  const tenant = tenantRow ? tenantConfigFromRow(tenantRow) : EMPTY_TENANT
  const { token, tokenHash } = generateToken()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1h

  await db.insert(adminPasswordTokens).values({ userId: user.id, tokenHash, type: "reset", expiresAt })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  const resetUrl = `${baseUrl}/admin/reset-password/${token}`

  const { subject, html, text } = buildForgotPasswordEmail({
    tenantName: tenant.name,
    logoUrl: safeLogoUrl(tenant.logoPath),
    nombre: user.name,
    resetUrl,
  })

  try {
    await sendEmail(tenant, user.email, subject, html, text)
  } catch (err) {
    // No tira: la respuesta sigue siendo { ok: true } a propósito (no filtrar si el email
    // existe), pero al menos loguea para que se pueda diagnosticar puertas adentro.
    console.error("[forgot-password] no se pudo enviar el mail:", err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({ ok: true })
}
