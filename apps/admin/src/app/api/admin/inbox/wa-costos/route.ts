import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { getWaCosts } from "@/lib/inbox-api"
import { botUsagePanelEnabled } from "@/lib/flags"

// Costos de WhatsApp del mes. Mismos gates que el panel de uso: flag + superadmin.
export async function GET() {
  if (!(await botUsagePanelEnabled())) return NextResponse.json({ error: "no encontrado" }, { status: 404 })

  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  if (!session.userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 })
  if (session.role !== "superadmin") return NextResponse.json({ error: "prohibido" }, { status: 403 })

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, session.tenantId))
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
