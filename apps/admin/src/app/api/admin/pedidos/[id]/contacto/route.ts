import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { contactoDe, estadoContacto, marcarContactado } from "@/lib/pedidos-contacto-repo"

// Seguimiento de contacto de un pedido pendiente (change `sucursales-igz-mdp`, rebanada B).
//
//   GET  /api/admin/pedidos/[id]/contacto → { umbralHoras, contactadoEn, contactadoPorNombre }
//   POST /api/admin/pedidos/[id]/contacto → "Marcar contactado" (sin body; una sola vez).
//
// Actor y tenant salen del guard. Pedido inexistente, ajeno o con id malformado → el mismo 404.
// Abierto desde OPERATOR.

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  try {
    const estado = await estadoContacto(guard.tenantId)
    const c = (await contactoDe(guard.tenantId, [id])).get(id)
    return Response.json(
      {
        umbralHoras: estado.umbralHoras,
        contactadoEn: c?.contactadoEn ? c.contactadoEn.toISOString() : null,
        contactadoPorNombre: c?.contactadoPorNombre ?? null,
      },
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[admin/pedidos/contacto] no se pudo leer", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo cargar el contacto del pedido. Inténtelo nuevamente.")
  }
}

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  try {
    const r = await marcarContactado(guard.tenantId, id, { id: guard.user.id, name: guard.user.name })
    if (r.kind === "not_found") return adminNotFoundResponse()
    if (r.kind === "cancelado") return fail(422, "cancelado", "Un pedido cancelado no admite marcarse como contactado.")
    if (r.kind === "ya_contactado") {
      // Idempotente: repetir devuelve lo que ya estaba, sin pisarlo.
      return Response.json(
        { ok: true, cambio: false, contactadoEn: r.contactadoEn.toISOString(), contactadoPorNombre: r.contactadoPorNombre },
        { headers: NO_STORE },
      )
    }
    return Response.json(
      { ok: true, cambio: true, contactadoEn: r.contactadoEn.toISOString(), contactadoPorNombre: r.contactadoPorNombre },
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[admin/pedidos/contacto] no se pudo marcar", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo marcar el pedido como contactado. Inténtelo nuevamente.")
  }
}
