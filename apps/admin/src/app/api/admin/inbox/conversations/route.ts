import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireSeccion } from "@/lib/admin-route-guard"
import { listConversations } from "@/lib/inbox-api"
import { operatorNamesByIds } from "@/lib/operator-names"
import { esRestringido, puedeVerCanal } from "@/lib/canal-acceso"
import { canalesDeConversaciones } from "@/lib/canal-acceso-conversacion"

export async function GET(req: Request) {
  const guard = await requireSeccion(req, "inbox")
  if (!guard.ok) return guard.response

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  const todas = await listConversations(tenant.aiApiUrl, tenant.aiTenantId)
  // Acceso por canal: un restringido solo ve las de sus canales (sin canal resuelto, ninguna).
  let conversations = todas
  if (esRestringido(guard.user)) {
    const canales = await canalesDeConversaciones({ aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }, todas)
    conversations = todas.filter((c) => puedeVerCanal(guard.user, canales.get(c.id)))
  }

  const nameById = await operatorNamesByIds(conversations.map((c) => c.assigned_operator_id))
  const enriched = conversations.map((c) => ({
    ...c,
    assigned_operator_name: c.assigned_operator_id ? nameById.get(c.assigned_operator_id) ?? null : null,
  }))
  return NextResponse.json(enriched)
}
