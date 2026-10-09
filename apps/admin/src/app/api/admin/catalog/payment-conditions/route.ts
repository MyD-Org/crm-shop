import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireAdminPlus } from "@/lib/admin-route-guard"

// GET /api/admin/catalog/payment-conditions
export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const db = getDb()
  const [tenant] = await db.select({ paymentConditions: tenants.paymentConditions }).from(tenants).where(eq(tenants.id, guard.tenantId))

  return NextResponse.json(tenant?.paymentConditions ?? [])
}

// PUT /api/admin/catalog/payment-conditions
// Body: [{ method: "Transferencia", description: "5% de descuento" }, ...]
export async function PUT(req: NextRequest) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json()
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "se esperaba un array de condiciones" }, { status: 400 })
  }

  const db = getDb()
  await db.update(tenants).set({ paymentConditions: body, updatedAt: new Date() }).where(eq(tenants.id, guard.tenantId))

  return NextResponse.json({ ok: true })
}
