import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { getBotStatus, setBotStatus } from "@/lib/inbox-api"

async function requireTenant(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return { error: guard.response }

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return { error: NextResponse.json({ error: "inbox no configurado" }, { status: 503 }) }
  }
  return { tenant }
}

export async function GET(req: Request) {
  const { error, tenant } = await requireTenant(req)
  if (error) return error

  const botEnabled = await getBotStatus(tenant.aiApiUrl, tenant.aiTenantId)
  return NextResponse.json({ botEnabled })
}

export async function POST(req: NextRequest) {
  const { error, tenant } = await requireTenant(req)
  if (error) return error

  const body = await req.json().catch(() => null)
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled inválido" }, { status: 400 })
  }

  await setBotStatus(tenant.aiApiUrl, tenant.aiTenantId, body.enabled)
  return NextResponse.json({ botEnabled: body.enabled })
}
