import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireSeccion } from "@/lib/admin-route-guard"
import { getContact, startAssist } from "@/lib/inbox-api"
import { esRestringido, puedeVerCanal } from "@/lib/canal-acceso"
import { exigirAccesoConversacion } from "@/lib/canal-acceso-conversacion"
import { canalKey } from "@/lib/inbox-canales"

// Copiloto del operador (ADR 0007). Busca-o-crea el hilo de asistencia del contacto en ai-api y
// devuelve al widget la conversación pre-creada + el session token (que el widget refresca
// re-llamando a este mismo endpoint). El baseUrl es el rewrite same-origin /ai-api.
export async function POST(req: Request, { params }: { params: Promise<{ endUserId: string }> }) {
  const guard = await requireSeccion(req, "inbox")
  if (!guard.ok) return guard.response

  const { endUserId } = await params
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  // La conversación abierta en el inbox. Opcional: sin ella ai-api deduce la más reciente
  // del contacto, que con varios números puede no ser la que el operador está mirando.
  const body = (await req.json().catch(() => null)) as { conversationId?: string } | null

  // Acceso por canal ANTES de pedirle nada a ai-api. Con conversationId se valida esa
  // conversación (ai-api ya exige que sea de este contacto); sin ella, el contacto y su hilo en
  // curso, y se fija esa conversación para que ai-api no deduzca otra (la de otro número).
  let conversationId = body?.conversationId
  if (esRestringido(guard.user)) {
    if (conversationId) {
      const acceso = await exigirAccesoConversacion(
        { aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }, guard.user, conversationId,
      )
      if (!acceso.ok) return NextResponse.json({ error: "contact_not_found" }, { status: 404 })
    } else {
      const contact = await getContact(tenant.aiApiUrl, tenant.aiTenantId, endUserId).catch(() => null)
      if (!contact || !puedeVerCanal(guard.user, canalKey(contact)) || !contact.current_conversation_id) {
        return NextResponse.json({ error: "contact_not_found" }, { status: 404 })
      }
      conversationId = contact.current_conversation_id
    }
  }

  // conversationId es opcional: sin valor no se pasa el argumento (un `undefined` explícito
  // rompería el contrato de la llamada).
  const result = conversationId
    ? await startAssist(tenant.aiApiUrl, tenant.aiTenantId, endUserId, conversationId)
    : await startAssist(tenant.aiApiUrl, tenant.aiTenantId, endUserId)
  if (!result.ok) {
    const status = result.error === "contact_not_found" ? 404
      : result.error === "assist_agent_not_configured" ? 409
      : 502
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({
    conversationId: result.session.conversationId,
    token: result.session.token,
    agentId: result.session.agentId,
    baseUrl: "/ai-api",
  })
}
