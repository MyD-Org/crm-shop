import { NextRequest, NextResponse } from "next/server"
import { getDb } from "@/db"
import { pushSubscriptions } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"

// POST /api/admin/push/subscribe
// Guarda (upsert por endpoint) la PushSubscription del navegador del operador logueado.
// El endpoint es único: re-suscribirse desde el mismo browser actualiza claves y dueño.
export async function POST(req: NextRequest) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const sub = body?.subscription
  const endpoint: unknown = sub?.endpoint
  const p256dh: unknown = sub?.keys?.p256dh
  const auth: unknown = sub?.keys?.auth
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return NextResponse.json({ error: "suscripción inválida" }, { status: 400 })
  }

  await getDb()
    .insert(pushSubscriptions)
    .values({
      tenantId: guard.tenantId,
      operatorId: guard.user.id,
      endpoint,
      p256dh,
      auth,
      userAgent: req.headers.get("user-agent"),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { tenantId: guard.tenantId, operatorId: guard.user.id, p256dh, auth, lastUsedAt: new Date() },
    })

  return NextResponse.json({ ok: true })
}
