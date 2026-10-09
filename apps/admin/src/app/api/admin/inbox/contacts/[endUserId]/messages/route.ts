import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { getContactMessages } from "@/lib/inbox-api"

export async function GET(req: Request, { params }: { params: Promise<{ endUserId: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { endUserId } = await params

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  const sp = new URL(req.url).searchParams
  const before = sp.get("before")
  const limit = sp.get("limit")

  try {
    const page = await getContactMessages(tenant.aiApiUrl, tenant.aiTenantId, endUserId, {
      before: before ? Number(before) : undefined,
      limit: limit ? Number(limit) : undefined,
    })
    return NextResponse.json(page)
  } catch {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 })
  }
}
