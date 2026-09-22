import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { cambiarEstado, getPedido, toPedidoDetalleDto } from "@/lib/pedidos-repo"
import {
  MOTIVO_MAX,
  MOTIVO_MIN,
  esEstadoPedido,
  mensajeTransicionInvalida,
  puedeTransicionar,
} from "@/lib/pedidos-transiciones"

// GET   /api/admin/pedidos/[id] — detalle con ítems.
// PATCH /api/admin/pedidos/[id] — cambio de estado. Body { estado, estadoEsperado, motivo? }.
//
// Un pedido inexistente, de OTRO tenant o con id malformado contesta EL MISMO 404
// (adminNotFoundResponse): nadie puede distinguir "no existe" de "no es suyo".
//
// Orden de chequeos del PATCH (el orden es parte del contrato, hay tests que lo fijan):
//   1. guard                 → 401 / 404 (rol)
//   2. payload               → 400 invalid
//   3. tabla de transiciones → 422 invalid_transition, sobre (estadoEsperado → estado) y SIN
//                              leer la base: un par prohibido es 422 aunque esté desactualizado
//   4. motivo (sólo cancelar)→ 422 reason_required / reason_too_long
//   5. UPDATE condicional    → 404 (no existe / otro tenant) · 409 conflict · 200
// Ningún cambio de estado manda mail ni WhatsApp (v0): el cliente lo ve en "Mis compras".

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, code, ...extra }, { status, headers: NO_STORE })

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    return Response.json(toPedidoDetalleDto(found.pedido, found.items), { headers: NO_STORE })
  } catch (err) {
    console.error("[admin/pedidos] no se pudo leer el detalle", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo cargar el pedido. Inténtelo nuevamente.")
  }
}

export async function PATCH(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  // Del body se leen SÓLO estos tres campos. Actor y tenant salen del guard: un
  // `estadoActualizadoPor` o un `tenantId` en el body no tienen ningún efecto.
  const body: unknown = await req.json().catch(() => null)
  const campos = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const { estado, estadoEsperado, motivo } = campos
  if (!esEstadoPedido(estado) || !esEstadoPedido(estadoEsperado)) {
    return fail(400, "invalid", "El estado indicado no es válido.")
  }

  if (!puedeTransicionar(estadoEsperado, estado)) {
    return fail(422, "invalid_transition", mensajeTransicionInvalida(estadoEsperado, estado))
  }

  // El motivo sólo cuenta al cancelar; en cualquier otra transición se ignora (ni se valida).
  let motivoLimpio: string | null = null
  if (estado === "cancelado") {
    const recortado = typeof motivo === "string" ? motivo.trim() : ""
    if (recortado.length < MOTIVO_MIN) {
      return fail(422, "reason_required", "Indique el motivo de la cancelación.")
    }
    if (recortado.length > MOTIVO_MAX) {
      return fail(422, "reason_too_long", `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`)
    }
    motivoLimpio = recortado
  }

  const { id } = await params
  const now = new Date()
  let result
  try {
    result = await cambiarEstado(guard.tenantId, id, {
      esperado: estadoEsperado,
      nuevo: estado,
      motivo: motivoLimpio,
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })
  } catch (err) {
    console.error("[admin/pedidos] no se pudo cambiar el estado", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo actualizar el pedido. Inténtelo nuevamente.")
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "conflict") {
    return fail(
      409,
      "conflict",
      "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente.",
      { estadoActual: result.actual },
    )
  }

  // Log estructurado del cambio. A propósito SIN el texto del motivo y sin datos del cliente.
  console.info(
    JSON.stringify({
      event: "shop_order_estado_changed",
      tenant: guard.tenantId,
      orderId: id,
      from: estadoEsperado,
      to: estado,
      actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
      at: now.toISOString(),
    }),
  )

  return Response.json(toPedidoDetalleDto(result.pedido, result.items), { headers: NO_STORE })
}
