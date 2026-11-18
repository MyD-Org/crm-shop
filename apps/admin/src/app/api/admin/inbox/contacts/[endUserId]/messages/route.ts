import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireSeccion } from "@/lib/admin-route-guard"
import { getContact, getContactMessages } from "@/lib/inbox-api"
import { esRestringido, puedeVerCanal } from "@/lib/canal-acceso"
import { canalKey } from "@/lib/inbox-canales"

export async function GET(req: Request, { params }: { params: Promise<{ endUserId: string }> }) {
  const guard = await requireSeccion(req, "inbox")
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
    // Acceso por canal: para un restringido se resuelve primero el contacto (el hilo del número
    // pedido en ?cuenta=) y se valida el canal que DEVOLVIÓ ai-api; después se piden solo los
    // mensajes de ese número. Sin acceso: el mismo 404 que un contacto inexistente.
    let account: string | null | undefined
    if (esRestringido(guard.user)) {
      const contact = await getContact(tenant.aiApiUrl, tenant.aiTenantId, endUserId, sp.get("cuenta"))
      if (!puedeVerCanal(guard.user, canalKey(contact))) {
        return NextResponse.json({ error: "contact_not_found" }, { status: 404 })
      }
      account = contact.channel_account_id ?? null
    }
    const page = await getContactMessages(tenant.aiApiUrl, tenant.aiTenantId, endUserId, {
      before: before ? Number(before) : undefined,
      limit: limit ? Number(limit) : undefined,
      ...(account ? { account } : {}),
    })
    return NextResponse.json(page)
  } catch {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 })
  }
}
