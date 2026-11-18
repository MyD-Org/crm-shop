import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireSeccion } from "@/lib/admin-route-guard"
import { exigirAccesoConversacion } from "@/lib/canal-acceso-conversacion"
import { retryMessage } from "@/lib/inbox-api"

// POST /api/admin/inbox/:id/messages/:messageId/retry
// Reintenta la entrega al canal de una burbuja saliente que quedó "no entregada".
export async function POST(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const guard = await requireSeccion(req, "inbox")
  if (!guard.ok) return guard.response

  const { id, messageId } = await params
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  // Acceso por canal ANTES de cualquier efecto: ajena o inexistente = el mismo 404.
  const acceso = await exigirAccesoConversacion(
    { aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }, guard.user, id,
  )
  if (!acceso.ok) return acceso.response

  const result = await retryMessage(tenant.aiApiUrl, tenant.aiTenantId, id, messageId)
  if (!result.ok) {
    const status = result.error === "window_closed" ? 409 : 502
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
