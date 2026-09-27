import { AlegraRateLimitError, findContactByIdentifier, listNumberTemplates } from "@/lib/alegra"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { resolverPreviewEmision } from "@/lib/factura-emitir"
import { getPedido } from "@/lib/pedidos-repo"
import { getTenantByIdFromDb } from "@/lib/tenants"

// "Emitir factura" del detalle de pedido (rebanada B: sólo el preview, sin escritura en
// Alegra). Endpoint y acción de UI separados de "Vincular factura"
// (.../factura/route.ts): acá se CREA la factura real en Alegra (rebanada C, el POST), no se
// vincula una ya emitida a mano.
//
//   GET /api/admin/pedidos/[id]/factura/emitir → preview (dry-run): líneas, total, contacto a
//   usar, numeraciones de factura activas + sugerida, y bloqueo/avisos si no se puede emitir.
//   NUNCA escribe: ni en Alegra ni en la base.
//
// Permiso `requireAdminPlus` (no `requireOperatorPlus`, a diferencia de "vincular"): emitir
// crea dinero real e irreversible en Alegra, aunque este verbo en particular sólo lea.
//
// Orden de chequeos: guard → pedido (404 / 409 ya facturado) → preview (lee Alegra: numeraciones
// + contacto si hace falta) → 200. Un pedido que no puede emitirse (ya facturado) no gasta cuota
// de Alegra.

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "private, no-store" }

const fail = (status: number, code: string, error: string) => Response.json({ error, code }, { status, headers: NO_STORE })

const MSG = {
  yaFacturado: "El pedido ya tiene una factura vinculada.",
  sinConfig: "No se pudo consultar Alegra para esta empresa. Inténtelo nuevamente en unos minutos.",
  limite: "Alegra está recibiendo demasiadas consultas. Inténtelo nuevamente en un minuto.",
  alegra: "Alegra no respondió bien. Inténtelo nuevamente en unos minutos.",
  interno: "No se pudo armar la vista previa de la factura. Inténtelo nuevamente.",
} as const

function errorAlegra(err: unknown, ctx: Record<string, unknown>): Response {
  if (err instanceof AlegraRateLimitError) {
    console.warn("[admin/pedidos/factura/emitir] Alegra 429", ctx)
    return fail(503, "alegra_limite", MSG.limite)
  }
  console.error("[admin/pedidos/factura/emitir] Alegra respondió mal", { ...ctx, err })
  return fail(502, "alegra_error", MSG.alegra)
}

type IdParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    // Idempotencia: un pedido ya facturado (emitido o vinculado a mano) no vuelve a mostrar un
    // preview de emisión — mismo código que usa "vincular" para "ya tiene otra factura".
    if (found.pedido.facturaAlegraId) return fail(409, "ya_vinculada", MSG.yaFacturado)

    const config = await getTenantByIdFromDb(guard.tenantId)
    if (!config) return fail(500, "internal", MSG.sinConfig)

    let preview
    try {
      preview = await resolverPreviewEmision(found.pedido, found.items, {
        listNumberTemplates: () => listNumberTemplates(config),
        findContactByIdentifier: (documento) => findContactByIdentifier(config, documento),
      })
    } catch (err) {
      return errorAlegra(err, ctx)
    }
    return Response.json(preview, { headers: NO_STORE })
  } catch (err) {
    console.error("[admin/pedidos/factura/emitir] no se pudo armar el preview", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }
}
