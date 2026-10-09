import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { getMessages } from "@/lib/inbox-api"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  const messages = await getMessages(tenant.aiApiUrl, tenant.aiTenantId, id)
  return NextResponse.json(messages)
}
