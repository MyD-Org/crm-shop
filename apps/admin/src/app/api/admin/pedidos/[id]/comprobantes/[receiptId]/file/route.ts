import { NextResponse } from "next/server"
import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { comprobanteDelPedido } from "@/lib/pedidos-repo"
import { extFor } from "@/lib/receipt-file"
import { getR2 } from "@/lib/r2"
import { GET_URL_TTL_SECONDS } from "@/lib/receipt-validation"

// GET /api/admin/pedidos/[id]/comprobantes/[receiptId]/file[?download=1] — el comprobante que
// subió el comprador, visto desde el DETALLE DEL PEDIDO (change `pago-transferencia-comprobante`,
// rebanada D).
//
// Mismo visor que `/api/admin/comprobantes/[id]/file` (302 a una URL GET firmada corta; nunca
// sirve bytes), pero con el guard del pedido (operador o más): quien registra el pago tiene que
// poder ver la constancia aunque el backoffice de comprobantes sea sólo de administradores. Sólo
// sirve un comprobante visible (`pending`/`loaded`) cuyo `shop_order_id` sea ESTE pedido del
// tenant; cualquier otro caso (ajeno, de otro pedido, rechazado, inexistente, id malformado)
// responde el mismo 404, sin oráculos de existencia.

type Params = { params: Promise<{ id: string; receiptId: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id, receiptId } = await params
  const comprobante = await comprobanteDelPedido(guard.tenantId, id, receiptId)
  if (!comprobante) return adminNotFoundResponse()

  const r2 = getR2()
  if (!r2) {
    return Response.json(
      { error: "El almacenamiento de comprobantes no está disponible, inténtelo nuevamente más tarde.", code: "storage_unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    )
  }

  const download = new URL(req.url).searchParams.get("download") === "1"
  const url = await r2.presignGet(comprobante.fileKey, {
    ttlSeconds: GET_URL_TTL_SECONDS,
    ...(download
      ? {
          responseContentDisposition: `attachment; filename="comprobante-${comprobante.paidOn}-${comprobante.id.slice(0, 8)}.${extFor(comprobante.fileMime)}"`,
        }
      : {}),
  })

  const res = NextResponse.redirect(url, 302)
  res.headers.set("Cache-Control", "private, no-store")
  res.headers.set("Referrer-Policy", "no-referrer")
  return res
}
