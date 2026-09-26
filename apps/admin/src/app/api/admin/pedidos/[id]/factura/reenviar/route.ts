import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { enviarFacturaPedido, logAvisoFactura, type AvisoFactura } from "@/lib/pedido-factura-aviso"
import { getPedido } from "@/lib/pedidos-repo"

// "Reenviar factura" del detalle de pedido: vuelve a mandarle al cliente el mail "Su factura"
// con el PDF de la factura vinculada (por ejemplo, si el primero no salió o no le llegó).
//
//   POST /api/admin/pedidos/[id]/factura/reenviar → 200 { avisoFactura: { resultado, destino } }.
//
// No cambia nada del pedido. Mismo guard que vincular (operator | admin | superadmin); el tenant
// sale del guard. Pedido inexistente, ajeno o con id malformado → el mismo 404. Sin factura
// vinculada → 422. Que el mail no salga (sin email, sin PDF, Resend) no es un error HTTP: va en
// `resultado`, como en el POST de vincular.

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  let aviso: AvisoFactura
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    if (!found.pedido.facturaAlegraId) {
      return fail(422, "sin_factura", "El pedido no tiene una factura vinculada.")
    }
    aviso = await enviarFacturaPedido({ tenantId: guard.tenantId, pedido: found.pedido, reenvio: new Date() })
  } catch (err) {
    console.error("[admin/pedidos/factura] no se pudo reenviar la factura", { ...ctx, err })
    return fail(500, "internal", "No se pudo reenviar la factura. Inténtelo nuevamente.")
  }

  // Sin datos del cliente: ids y actor.
  console.info(
    JSON.stringify({
      event: "shop_order_factura_reenviada",
      ...ctx,
      actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
    }),
  )
  logAvisoFactura(ctx, aviso)
  return Response.json({ avisoFactura: { resultado: aviso.resultado, destino: aviso.destino } }, { headers: NO_STORE })
}
