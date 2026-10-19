import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { listWhatsappNumbersRaw } from "@/lib/inbox-api"
import { esRestringido, filtrarNumerosRaw } from "@/lib/canal-acceso"

// GET /api/admin/whatsapp-numbers — los números de WhatsApp del tenant, para elegir por
// cuál sale un envío proactivo (automatizaciones) o sobre qué WABA operar las plantillas.
//
// A diferencia de las plantillas, acá alcanza con staff: no expone credenciales ni crea
// nada en Meta, solo lista lo que ya está configurado.
export async function GET(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "canal no configurado" }, { status: 503 })
  }

  const res = await listWhatsappNumbersRaw(tenant.aiApiUrl, tenant.aiTenantId, guard.user.role)
  const text = await res.text()
  // Un operador restringido por canal solo ve los números de sus canales (lib/canal-acceso.ts).
  // Los demás reciben la respuesta de ai-api sin tocar.
  if (res.ok && esRestringido(guard.user)) {
    let parsed: unknown = []
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = []
    }
    return NextResponse.json(filtrarNumerosRaw(guard.user, parsed), { status: res.status })
  }
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } })
}
