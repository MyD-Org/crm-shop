import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { priceLists } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const db = getDb()

  const [list] = await db
    .select({ fileData: priceLists.fileData, fileName: priceLists.fileName })
    .from(priceLists)
    .where(and(eq(priceLists.id, id), eq(priceLists.tenantId, guard.tenantId)))

  if (!list?.fileData) return NextResponse.json({ error: "archivo no disponible" }, { status: 404 })

  return new NextResponse(list.fileData as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${list.fileName ?? "lista-precios.xlsx"}"`,
    },
  })
}
