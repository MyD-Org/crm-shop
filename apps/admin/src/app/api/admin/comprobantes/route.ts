import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { cleanupStale, listAdmin, toAdminDto } from "@/lib/payment-receipts"
import { r2Config } from "@/lib/r2"

// GET /api/admin/comprobantes — listado del backoffice. Solo ve `pending`/`loaded`
// (uploading/processing/rejected son invisibles: ni siquiera el count los incluye).
// NUNCA devuelve URLs firmadas ni file_key/sha256: el archivo se ve por /[id]/file (302).
//
// Limpieza lazy: antes de listar borra los `uploading` vencidos y los `rejected` viejos del
// tenant. Vivía sólo en el init del portal; cuando el portal se muda al Shop, el Shop no
// tiene DELETE sobre payment_receipts (0032), así que el backoffice queda como el que limpia.

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)

  const status = url.searchParams.get("status") ?? "pending"
  if (status !== "pending" && status !== "loaded" && status !== "all") {
    return Response.json({ error: "El estado es inválido", code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  const email = url.searchParams.get("email")
  if (email !== null && email !== "failed") {
    return Response.json({ error: "El filtro de email es inválido", code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  const startParam = url.searchParams.get("start")
  const start = startParam === null ? 0 : Number(startParam)
  if (!Number.isInteger(start) || start < 0) {
    return Response.json({ error: "La paginación es inválida", code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  const limitParam = url.searchParams.get("limit")
  const limit = limitParam === null ? undefined : Number(limitParam)
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return Response.json({ error: "El límite es inválido", code: "invalid" }, { status: 400, headers: NO_STORE })
  }

  const now = new Date()
  try {
    await cleanupStale(guard.tenantId, now)
  } catch (err) {
    // La limpieza es de mantenimiento: si falla, el listado igual responde.
    console.error("[comprobantes] cleanupStale falló", err instanceof Error ? err.message : "error desconocido")
  }
  const { items, total } = await listAdmin(
    guard.tenantId,
    { status, email: email ?? undefined, start, limit },
    now,
  )

  const [tenant] = await getDb()
    .select({ receiptsEmail: tenants.receiptsEmail })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))

  return Response.json(
    {
      items: items.map((row) => toAdminDto(row, now)),
      total,
      receiptsEmailConfigured: (tenant?.receiptsEmail ?? "") !== "",
      storageConfigured: r2Config() !== null,
    },
    { headers: NO_STORE },
  )
}
