import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { extenderReserva } from "@/lib/pedidos-reserva-repo"

// POST /api/admin/pedidos/[id]/reserva → "Extender reserva" de un pendiente sin pago: corre el
// vencimiento a ahora + los días de reserva de las reglas de venta (change `sucursales-igz-mdp`,
// rebanada B). Sin body. Solo admin y superadmin. Pedido inexistente, ajeno o con id malformado →
// el mismo 404.

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  try {
    const r = await extenderReserva(guard.tenantId, id)
    if (r.kind === "not_found") return adminNotFoundResponse()
    if (r.kind === "no_aplica") {
      return fail(422, "no_aplica", "Solo se puede extender la reserva de un pedido pendiente y sin pago.")
    }
    return Response.json({ ok: true, venceEn: r.venceEn ? r.venceEn.toISOString() : null }, { headers: NO_STORE })
  } catch (err) {
    console.error("[admin/pedidos/reserva] no se pudo extender", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo extender la reserva. Inténtelo nuevamente.")
  }
}
