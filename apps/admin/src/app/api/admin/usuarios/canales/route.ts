import { eq, isNotNull, and } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, tenants } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { listContacts, listWhatsappNumbersRaw } from "@/lib/inbox-api"
import { parseWhatsappNumbers } from "@/lib/inbox-canales"
import { listarNombres } from "@/lib/inbox-canales-repo"
import { opcionesDeCanales } from "@/lib/canal-acceso"

// GET /api/admin/usuarios/canales — canales que se pueden otorgar a un operador (selector
// "Canales con acceso" de la gestión de usuarios). Solo admin y superadmin.
//
// Mejor esfuerzo: si ai-api no responde, el selector igual ofrece los canales nombrados y los que
// algún usuario ya tiene guardados (así nunca queda un canal imposible de quitar).

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const db = getDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, guard.tenantId))

  const [nombres, guardadasRows, numeros, contactos] = await Promise.all([
    listarNombres(guard.tenantId).catch(() => ({}) as Record<string, string>),
    db
      .select({ canales: adminUsers.canalesPermitidos })
      .from(adminUsers)
      .where(and(eq(adminUsers.tenantId, guard.tenantId), isNotNull(adminUsers.canalesPermitidos))),
    tenant?.aiApiUrl && tenant.aiTenantId
      ? listWhatsappNumbersRaw(tenant.aiApiUrl, tenant.aiTenantId, guard.user.role)
          .then(async (r) => (r.ok ? parseWhatsappNumbers(await r.json()) : []))
          .catch(() => [])
      : [],
    tenant?.aiApiUrl && tenant.aiTenantId
      ? listContacts(tenant.aiApiUrl, tenant.aiTenantId, "all").catch(() => [])
      : [],
  ])

  const guardadas = [...new Set(guardadasRows.flatMap((r) => r.canales ?? []))]
  return Response.json({ canales: opcionesDeCanales({ numeros, contactos, nombres, guardadas }) }, { headers: NO_STORE })
}
