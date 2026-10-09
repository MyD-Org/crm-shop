import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { getWaCosts } from "@/lib/inbox-api"
import { botUsagePanelEnabled } from "@/lib/flags"

// Costos de WhatsApp del mes. Mismos gates que el panel de uso: flag + superadmin.
export async function GET(req: Request) {
  if (!(await botUsagePanelEnabled())) return NextResponse.json({ error: "no encontrado" }, { status: 404 })

  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  // Solo superadmin (mismo 404 que el guard).
  if (guard.user.role !== "superadmin") return adminNotFoundResponse()

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  try {
    return NextResponse.json(await getWaCosts(tenant.aiApiUrl, tenant.aiTenantId))
  } catch {
    // ai-api sin el endpoint (deploy desfasado) o caída: el cliente lo muestra como "No se pudo consultar".
    return NextResponse.json({ error: "no se pudo consultar" }, { status: 502 })
  }
}
