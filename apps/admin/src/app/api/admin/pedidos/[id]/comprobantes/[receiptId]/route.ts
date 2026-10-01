import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { getAdmin, toAdminDtoConPedido } from "@/lib/payment-receipts"

// GET /api/admin/pedidos/[id]/comprobantes/[receiptId] — detalle de un comprobante visto desde el
// DETALLE DEL PEDIDO (guard de operador o más), para que el popup del pedido muestre los mismos
// datos que el de la pantalla Comprobantes (admin+). Es de sólo lectura: las acciones (cargar en
// Alegra, marcar, reenviar) siguen siendo de `/api/admin/comprobantes/[id]`, sólo admin+.
// Sólo sirve un comprobante visible cuyo `shop_order_id` sea ESTE pedido del tenant; todo lo
// demás (ajeno, de otro pedido, rechazado, inexistente, id malformado) responde el mismo 404.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: Promise<{ id: string; receiptId: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id, receiptId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(receiptId)) return adminNotFoundResponse()

  const row = await getAdmin(guard.tenantId, receiptId)
  if (!row || row.shopOrderId !== id) return adminNotFoundResponse()

  return Response.json(await toAdminDtoConPedido(guard.tenantId, row, new Date()), {
    headers: { "Cache-Control": "private, no-store" },
  })
}
