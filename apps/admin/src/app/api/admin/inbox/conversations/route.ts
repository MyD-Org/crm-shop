import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { listConversations } from "@/lib/inbox-api"
import { operatorNamesByIds } from "@/lib/operator-names"

export async function GET() {
  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  if (!session.userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 })

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, session.tenantId))
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
