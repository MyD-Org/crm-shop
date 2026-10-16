import { NextResponse, after } from "next/server"
import { resolveRequestTenantId } from "@/lib/tenant-context"
import { getTenantById, leerTenantDeDb, type TenantConfig } from "@/lib/tenants"
import { firmaValida, procesarEvento, type EventDocument } from "@/lib/plataforma-receptor"
import { avisarShop } from "@/lib/aviso-shop"

// Webhook de la plataforma. El tenant sale del host (como toda ruta del admin) y la firma se
// verifica con el secret de ESE tenant sobre el body crudo. Responde rápido; el aviso al Shop
// (descartar su caché) va en after(). Los 401 no distinguen motivo (no se revela si el tenant
// tiene o no plataforma configurada). Si la DB falla al leer el tenant se responde 503 (la plataforma
// reintenta los 5xx; un 401 por culpa de una caída de DB no se reintentaría y perdería el evento).
// El aviso al Shop sólo se hace con el tenant en modo `on`: antes del corte el Shop lee la tabla y
// los escritores duales ya lo avisan.
export const maxDuration = 30

export async function POST(req: Request) {
  const tenantId = await resolveRequestTenantId(req)
  let tenant: TenantConfig | null = null
  if (tenantId) {
    try {
      tenant = (await leerTenantDeDb(tenantId)) ?? getTenantById(tenantId)
    } catch (err) {
      console.error(`[plataforma] no se pudo leer el tenant=${tenantId}: ${err instanceof Error ? err.message : "error"}`)
      return NextResponse.json({ error: "tenant_no_disponible" }, { status: 503 })
    }
  }
  const crudo = await req.text()
  if (!tenant?.plataformaWebhookSecret || !firmaValida(tenant.plataformaWebhookSecret, crudo, req.headers.get("x-platform-signature-256"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const deliveryId = req.headers.get("x-platform-delivery")
  if (!deliveryId) return NextResponse.json({ error: "sin_delivery" }, { status: 400 })
  let ev: EventDocument
  try {
    ev = JSON.parse(crudo) as EventDocument
    if (!ev || typeof ev.action !== "string" || typeof ev.id !== "string") throw new Error("shape")
  } catch {
    return NextResponse.json({ error: "body_invalido" }, { status: 400 })
  }
  const resultado = await procesarEvento(tenant.id, deliveryId, ev)
  console.log(`[plataforma] tenant=${tenant.id} action=${ev.action} delivery=${deliveryId.slice(0, 8)} resultado=${resultado}`)
  if (resultado === "procesado" && tenant.plataformaAtributos === "on") after(() => avisarShop(tenant.id))
  return NextResponse.json({ resultado })
}
