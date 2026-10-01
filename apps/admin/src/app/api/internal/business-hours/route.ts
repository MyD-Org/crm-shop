import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { sucursales, tenants } from "@/db/schema"
import { bearerMatches } from "@/lib/secure-compare"
import { armarBusinessHours } from "@/lib/business-hours"

// Endpoint interno: el ai-api consulta el horario de atención del tenant para saber si está
// abierto y a qué hora. Contrato (aditivo, ver platform/contracts/crm-ai-api.md):
//   { notes: string | null,
//     schedule: { monday: [{open,close}, ...], ..., sunday: [] },
//     sucursales: [{ slug, nombre, ciudad, predeterminada, schedule, notes }] }
// `notes` y `schedule` (raíz) son el legado: salen de la sucursal predeterminada activa o, sin
// sucursales activas, de la empresa. `notes` se genera a partir de las excepciones (feriados,
// vacaciones, horario especial) renderizadas como texto. `schedule` siempre trae las 7 claves
// (día sin franjas = cerrado). Sin `abierto_ahora`: lo calcula el ai-api. Auth via INTERNAL_SECRET.
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.INTERNAL_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const aiTenantId = searchParams.get("tenantId")
  if (!aiTenantId) return Response.json({ error: "missing tenantId" }, { status: 400 })

  const db = getDb()
  const [tenant] = await db
    .select({
      id: tenants.id,
      schedule: tenants.schedule,
      scheduleExceptions: tenants.scheduleExceptions,
    })
    .from(tenants)
    .where(eq(tenants.aiTenantId, aiTenantId))

  const activas = tenant
    ? await db
        .select({
          slug: sucursales.slug,
          nombre: sucursales.nombre,
          ciudad: sucursales.ciudad,
          predeterminada: sucursales.predeterminada,
          orden: sucursales.orden,
          schedule: sucursales.schedule,
          scheduleExceptions: sucursales.scheduleExceptions,
        })
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenant.id), eq(sucursales.activa, true)))
    : []

  return Response.json(armarBusinessHours(tenant, activas))
}
