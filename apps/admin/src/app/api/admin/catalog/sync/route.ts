import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { desc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogSyncLog } from "@/db/schema"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { getTenantByIdFromDb } from "@/lib/tenants"
import { PRESUPUESTO_TRAMO_MS, syncTenant } from "@/lib/alegra-sync-tenant"

// Catálogos grandes pueden necesitar varias tandas de páginas a Alegra (30 items/página,
// tope de la API). El default de la plataforma no alcanzaba y la sync daba 504.
export const maxDuration = 300

// POST: dispara una sincronización manual del catálogo con Alegra (botón del admin): la cuenta
// principal y después cada cuenta secundaria activa (lib/alegra-sync-tenant.ts). Es reanudable por
// tramos: procesa hasta ~220 s y, si no terminó, responde 200 con `continuar: true` y el avance en
// `progreso`; el botón vuelve a llamar hasta que deje de venir.
export async function POST(req: Request) {
  // admin+ (operator → 404): sincronizar toca el catálogo de toda la tienda.
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const tenant = await getTenantByIdFromDb(guard.tenantId)
  if (!tenant) return Response.json({ error: "tenant no encontrado" }, { status: 404 })

  const result = await syncTenant(tenant, "manual", { presupuestoMs: PRESUPUESTO_TRAMO_MS })
  return Response.json(result, { status: result.ok ? 200 : 502, headers: { "Cache-Control": "private, no-store" } })
}

// GET: última sincronización (para mostrar estado/fecha en el admin).
export async function GET() {
  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  if (!session.userId) return Response.json({ error: "no autorizado" }, { status: 401 })

  const [last] = await getDb()
    .select()
    .from(catalogSyncLog)
    .where(eq(catalogSyncLog.tenantId, session.tenantId))
    .orderBy(desc(catalogSyncLog.startedAt))
    .limit(1)

  return Response.json({ last: last ?? null })
}
