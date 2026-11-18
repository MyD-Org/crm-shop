import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireSeccion } from "@/lib/admin-route-guard"
import { exigirAccesoConversacion } from "@/lib/canal-acceso-conversacion"
import { getMessages } from "@/lib/inbox-api"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSeccion(req, "inbox")
  if (!guard.ok) return guard.response

  const { id } = await params
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  // Acceso por canal ANTES de cualquier efecto: ajena o inexistente = el mismo 404.
  const acceso = await exigirAccesoConversacion(
    { aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }, guard.user, id,
  )
  if (!acceso.ok) return acceso.response

  const messages = await getMessages(tenant.aiApiUrl, tenant.aiTenantId, id)
  return NextResponse.json(messages)
}
