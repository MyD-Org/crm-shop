import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { avisarClientePedido, logAviso } from "@/lib/pedido-estado-aviso"
import { registrarPagoManual, toPedidoDetalleDto, type PagoManualResult } from "@/lib/pedidos-repo"

// "Registrar pago" del detalle de pedido, para los medios que cobra el comercio por fuera de la
// tienda (transferencia, efectivo, cuenta corriente, a coordinar). Guarda quién lo hizo.
//
//   POST   /api/admin/pedidos/[id]/pago → pago_estado 'pendiente' → 'pagado' y mail al cliente.
//   DELETE /api/admin/pedidos/[id]/pago → 'pagado' → 'pendiente' (un pago cargado por error).
//
// Sin body: la ruta sólo mueve entre esos dos valores, y las dos son idempotentes (repetir no
// cambia nada ni vuelve a mandar el mail). Los pagos online (Mercado Pago) se rechazan con 422:
// esos los mueve sólo el webhook del proveedor, en el Shop. Mismo guard que el cambio de
// estado; pedido inexistente, ajeno o con id malformado → el mismo 404.

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

const MSG = {
  noManual: "El pago de este pedido lo registra el medio de pago en línea. No se puede modificar desde aquí.",
  cancelado: "Un pedido cancelado no admite registrar un pago.",
  interno: "No se pudo actualizar el pago. Inténtelo nuevamente.",
} as const

async function mover(req: Request, { params }: IdParams, pagado: boolean): Promise<Response> {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  const now = new Date()
  let result: PagoManualResult
  try {
    result = await registrarPagoManual(guard.tenantId, id, {
      pagado,
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })
  } catch (err) {
    console.error("[admin/pedidos/pago] no se pudo actualizar el pago", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "no_manual") return fail(422, "pago_online", MSG.noManual)
  if (result.kind === "cancelado") return fail(422, "cancelado", MSG.cancelado)

  if (result.cambio) {
    // Sin datos del cliente: ids y actor.
    console.info(
      JSON.stringify({
        event: pagado ? "shop_order_pago_registrado" : "shop_order_pago_anulado",
        ...ctx,
        actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
        at: now.toISOString(),
      }),
    )
    if (pagado) {
      const aviso = await avisarClientePedido({ tenantId: guard.tenantId, pedido: result.pedido, aviso: "pago_recibido", now })
      logAviso("pago_recibido", ctx, aviso)
    }
  }

  return Response.json(toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios), { headers: NO_STORE })
}

export function POST(req: Request, ctx: IdParams) {
  return mover(req, ctx, true)
}

export function DELETE(req: Request, ctx: IdParams) {
  return mover(req, ctx, false)
}
