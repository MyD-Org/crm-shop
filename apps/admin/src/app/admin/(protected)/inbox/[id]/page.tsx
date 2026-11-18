import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { accesoSeccion } from "@/lib/secciones-acceso"
import { listConversations, getMessages } from "@/lib/inbox-api"
import { ThreadView } from "@/components/admin/ThreadView"
import { exigirAccesoConversacion } from "@/lib/canal-acceso-conversacion"

export const dynamic = "force-dynamic"

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Sección Mensajes con la fila fresca (rol, tenant e id del usuario), nunca la cookie.
  const acceso = await accesoSeccion("inbox")
  if (!acceso) notFound()
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, acceso.tenantId))

  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return (
      <div className="p-6">
        <div className="rounded-[var(--radius)] p-4 text-sm" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          El inbox no está configurado.
        </div>
      </div>
    )
  }

  // Acceso por canal (la URL del push apunta acá): ajena o inexistente = el mismo notFound().
  const accesoCanal = await exigirAccesoConversacion(
    { aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }, acceso.user, id,
  )
  if (!accesoCanal.ok) notFound()

  const [conversations, messages] = await Promise.all([
    listConversations(tenant.aiApiUrl, tenant.aiTenantId),
    getMessages(tenant.aiApiUrl, tenant.aiTenantId, id).catch(() => null),
  ])

  const conversation = conversations.find((c) => c.id === id)
  if (!conversation || messages === null) notFound()

  return (
    <ThreadView
      conversation={conversation}
      initialMessages={messages}
      currentUserId={acceso.userId}
    />
  )
}
