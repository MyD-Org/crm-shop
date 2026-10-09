import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { getContact } from "@/lib/inbox-api"
import { enrichContact } from "@/lib/inbox-contacts"

export async function GET(req: Request, { params }: { params: Promise<{ endUserId: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { endUserId } = await params

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  let contact
  try {
    contact = await getContact(tenant.aiApiUrl, tenant.aiTenantId, endUserId, new URL(req.url).searchParams.get("cuenta"))
  } catch {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 })
  }

  // Operador (fuente de verdad: CRM) + departamento (de ai-api).
  const enriched = await enrichContact(
    { id: tenant.id, aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId },
    contact,
  )
  return NextResponse.json(enriched)
}
