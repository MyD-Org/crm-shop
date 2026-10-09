import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { getUsageSummary } from "@/lib/inbox-api"
import { botUsagePanelEnabled } from "@/lib/flags"

export async function GET(req: NextRequest) {
  // Feature gateada por flag (migrará a ia-dashboard).
  if (!(await botUsagePanelEnabled())) return NextResponse.json({ error: "no encontrado" }, { status: 404 })

  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  // El gasto es información de nivel administración: solo superadmin (mismo 404 que el guard).
  if (guard.user.role !== "superadmin") return adminNotFoundResponse()

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 90)
  const summary = await getUsageSummary(tenant.aiApiUrl, tenant.aiTenantId, days)
  return NextResponse.json(summary)
}
