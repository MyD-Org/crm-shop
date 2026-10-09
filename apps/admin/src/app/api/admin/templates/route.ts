import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { listTemplatesRaw, createTemplateRaw } from "@/lib/inbox-api"

// Gestión de plantillas: acción sensible (crea recursos en Meta), solo superadmin.
async function requireSuperadmin(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return { error: guard.response }
  // Solo superadmin; cualquier otro rol recibe el mismo 404 que el guard.
  if (guard.user.role !== "superadmin") return { error: adminNotFoundResponse() }

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return { error: NextResponse.json({ error: "canal no configurado" }, { status: 503 }) }
  }
  return { role: guard.user.role, aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }
}

// Reenvía la respuesta de ai-api tal cual (status + JSON) para conservar el detalle de un
// rechazo de Meta (422 meta_rejected) y demás errores.
async function forward(res: Response): Promise<NextResponse> {
  const text = await res.text()
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } })
}

// GET /api/admin/templates — lista (reconciliando contra Meta primero).
export async function GET(req: NextRequest) {
  const ctx = await requireSuperadmin(req)
  if ("error" in ctx) return ctx.error
  const channelAccountId = req.nextUrl.searchParams.get("channelAccountId") ?? undefined
  return forward(await listTemplatesRaw(ctx.aiApiUrl, ctx.aiTenantId, ctx.role, true, channelAccountId))
}

// POST /api/admin/templates — crea una plantilla.
export async function POST(req: NextRequest) {
  const ctx = await requireSuperadmin(req)
  if ("error" in ctx) return ctx.error
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "body inválido" }, { status: 400 })
  return forward(await createTemplateRaw(ctx.aiApiUrl, ctx.aiTenantId, ctx.role, body))
}
