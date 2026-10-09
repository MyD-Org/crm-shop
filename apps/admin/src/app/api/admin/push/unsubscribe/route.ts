import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { pushSubscriptions } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"

// POST /api/admin/push/unsubscribe
// Borra la suscripción por endpoint (el operador desactivó las notificaciones en este browser).
export async function POST(req: NextRequest) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const endpoint: unknown = body?.endpoint
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint requerido" }, { status: 400 })
  }

  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  return NextResponse.json({ ok: true })
}
