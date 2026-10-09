import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { listConversations } from "@/lib/inbox-api"
import { operatorNamesByIds } from "@/lib/operator-names"

export async function GET(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  const conversations = await listConversations(tenant.aiApiUrl, tenant.aiTenantId)

  const nameById = await operatorNamesByIds(conversations.map((c) => c.assigned_operator_id))
  const enriched = conversations.map((c) => ({
    ...c,
    assigned_operator_name: c.assigned_operator_id ? nameById.get(c.assigned_operator_id) ?? null : null,
  }))
  return NextResponse.json(enriched)
}
