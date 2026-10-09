import { NextResponse } from "next/server"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { priceLists, catalogItems } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"

// GET /api/admin/catalog — lista todas las price_lists del tenant con conteo de items
export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const db = getDb()
  const lists = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.tenantId, guard.tenantId))
    .orderBy(priceLists.createdAt)

  // Conteo de items por lista
  const counts = await Promise.all(
    lists.map(async (l) => {
      const items = await db
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(eq(catalogItems.priceListId, l.id))
      return { id: l.id, count: items.length }
    }),
  )

  const countMap = Object.fromEntries(counts.map((c) => [c.id, c.count]))
  const result = lists.map((l) => ({ ...l, itemCount: countMap[l.id] ?? 0 }))

  return NextResponse.json(result)
}
