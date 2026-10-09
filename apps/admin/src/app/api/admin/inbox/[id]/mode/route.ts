import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { setMode } from "@/lib/inbox-api"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body?.mode || !["bot", "human"].includes(body.mode)) {
    return NextResponse.json({ error: "mode inválido" }, { status: 400 })
  }

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  const operatorName = body.mode === "human" ? guard.user.name : undefined
  await setMode(tenant.aiApiUrl, tenant.aiTenantId, id, body.mode, operatorName)
  return NextResponse.json({ ok: true, assigned_to: operatorName ?? null })
}
