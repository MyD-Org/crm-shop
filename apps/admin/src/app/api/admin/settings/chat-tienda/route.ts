import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { parseChatTienda } from "@/lib/chat-tienda"

// GET/PUT /api/admin/settings/chat-tienda — texto del chat vacío y preguntas sugeridas del chat
// del Shop (Datos → Chat de la tienda). Vacíos = el Shop usa sus textos por defecto. El Shop los
// lee por request, así que no hace falta avisarle. El UPDATE toca SOLO el tenant del guard.

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const [tenant] = await getDb()
    .select({ emptyState: tenants.chatEmptyState, suggestions: tenants.chatSuggestions })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))

  return Response.json(
    { emptyState: tenant?.emptyState ?? "", suggestions: tenant?.suggestions ?? [] },
    { headers: NO_STORE },
  )
}

export async function PUT(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const parsed = parseChatTienda(await req.json().catch(() => null))
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  const { emptyState, suggestions } = parsed.value
  await getDb()
    .update(tenants)
    .set({ chatEmptyState: emptyState, chatSuggestions: suggestions, updatedAt: new Date() })
    .where(eq(tenants.id, guard.tenantId))

  return Response.json({ ok: true, emptyState, suggestions }, { headers: NO_STORE })
}
