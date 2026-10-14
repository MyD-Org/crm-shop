import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"

// Genera el link de Embedded Signup para conectar OTRO número de WhatsApp al tenant de la
// sesión. El tenant sale siempre de la sesión (aiTenantId del tenant del superadmin): un
// body.tenantId distinto se rechaza con 403 sin llamar a ai-api, porque emitir un link para
// otra empresa es poder enchufar un número en la cuenta de otro cliente. El alta de números
// de empresas clientes se atiende desde el dashboard de plataforma (ai-dashboard), no desde acá.
//
// El link lo firma la ai-api, no el CRM: la clave de firma vive en un solo lado.
async function requireSuperadmin(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return { error: guard.response }
  // Solo superadmin; cualquier otro rol recibe el mismo 404 que el guard.
  if (guard.user.role !== "superadmin") return { error: adminNotFoundResponse() }

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiApiUrl) {
    return { error: NextResponse.json({ error: "canal no configurado" }, { status: 503 }) }
  }
  return { aiApiUrl: tenant.aiApiUrl, ownAiTenantId: tenant.aiTenantId }
}

export async function POST(req: NextRequest) {
  const ctx = await requireSuperadmin(req)
  if ("error" in ctx) return ctx.error

  const body = (await req.json().catch(() => null)) as
    | { tenantId?: string; metaAppSlug?: string }
    | null
  if (typeof body?.metaAppSlug !== "string" || !body.metaAppSlug.trim()) return NextResponse.json({ error: "falta metaAppSlug" }, { status: 400 })

  const tenantId = ctx.ownAiTenantId
  if (!tenantId) return NextResponse.json({ error: "falta tenantId" }, { status: 400 })
  if (body.tenantId && body.tenantId !== tenantId) {
    return NextResponse.json({ error: "No puede emitir enlaces para otra empresa." }, { status: 403 })
  }

  const res = await fetch(`${ctx.aiApiUrl.replace(/\/$/, "")}/onboarding/whatsapp/links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.INTERNAL_SECRET ?? ""}`,
    },
    body: JSON.stringify({ tenantId, metaAppSlug: body.metaAppSlug }),
    cache: "no-store",
  })
  const text = await res.text()
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } })
}
