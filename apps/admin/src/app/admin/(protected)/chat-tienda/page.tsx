import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { ChatTiendaForm } from "@/components/admin/ChatTiendaForm"

export const dynamic = "force-dynamic"

// Textos del chat del Shop: el del chat vacío y las preguntas sugeridas. Admin+ (operator → 404).
export default async function ChatTiendaPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const [tenant] = await getDb()
    .select({ emptyState: tenants.chatEmptyState, suggestions: tenants.chatSuggestions })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))
  if (!tenant) notFound()

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Chat de la tienda</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Lo que ve el cliente al abrir el asistente de la tienda, antes de escribir
        </p>
      </div>
      <ChatTiendaForm initialEmptyState={tenant.emptyState} initialSuggestions={tenant.suggestions} />
    </div>
  )
}
