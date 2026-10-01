import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { avisarCambioEstadoPedido, logAviso } from "@/lib/pedido-estado-aviso"
import { cambiarEstado, getEntregaTipoPedido, getPedido, toPedidoDetalleDto } from "@/lib/pedidos-repo"
import {
  MOTIVO_MAX,
  MOTIVO_MIN,
  esEstadoPedido,
  mensajeNoCancelable,
  mensajeTransicionInvalida,
  puedeTransicionar,
} from "@/lib/pedidos-transiciones"
import { canSeeCosts, roleRank } from "@/lib/roles"

// GET   /api/admin/pedidos/[id] — detalle con ítems.
// PATCH /api/admin/pedidos/[id] — cambio de estado. Body { estado, estadoEsperado, motivo? }.
//
// Un pedido inexistente, de OTRO tenant o con id malformado contesta EL MISMO 404
// (adminNotFoundResponse): nadie puede distinguir "no existe" de "no es suyo".
//
// Orden de chequeos del PATCH (el orden es parte del contrato, hay tests que lo fijan):
//   1. guard                 → 401 / 404 (rol)
//   2. payload               → 400 invalid
//   3. entrega_tipo          → 404 (no existe / otro tenant / id malformado). Un retiro no
//                              tiene parada "en_camino": la tabla de transiciones lo necesita
//                              ANTES de validar el par, y sale de la BASE (nunca del body) para
//                              que el operador no pueda declarar el tipo de entrega que quiere.
//   4. tabla de transiciones → 422 invalid_transition, sobre (estadoEsperado → estado, según el
//                              entrega_tipo leído en el paso 3); no mira el `estado` ACTUAL de
//                              la fila, así que un par prohibido es 422 aunque esté desactualizado
//   5. motivo (sólo cancelar)→ 422 reason_required / reason_too_long
//   6. cambiarEstado         → 422 not_cancelable (cancelar un pedido pagado, facturado, con
//                              pago online en curso o que estuvo entregado; se decide dentro de la
//                              transacción) · 409 conflict · 200
// Tras un 200 se le manda un mail al cliente si la transición es un avance o una cancelación
// (pedido-estado-email.ts). Un mail que no sale no cambia la respuesta: el estado ya quedó.

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
    return Response.json(toPedidoDetalleDto(found.pedido, found.items, found.listaPrecios, found.historial, found.remito, { incluirCosto: canSeeCosts(guard.user.role), pagoManual: found.pagoManual,
    }), {
      headers: NO_STORE,
    })
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
  const forzar = campos.forzar === true
  if (!esEstadoPedido(estado) || !esEstadoPedido(estadoEsperado)) {
    return fail(400, "invalid", "El estado indicado no es válido.")
  }

  // "Cancelar con devolución": sólo admin o superior, sólo para cancelar. Se valida ANTES de leer
  // nada del pedido: un operador no se entera de nada, y un body armado a mano no lo salta.
  if (forzar) {
    if (roleRank(guard.user.role) < roleRank("admin")) {
      return fail(403, "forbidden", "Su rol no permite cancelar con devolución.")
    }
    if (estado !== "cancelado") {
      return fail(400, "invalid", "La cancelación con devolución sólo aplica a cancelar el pedido.")
    }
  }

  const { id } = await params

  // El tipo de entrega sale de la BASE, nunca del body: es el dato que decide si `en_camino`
  // es un destino válido. De paso, esto contesta el 404 de "no existe / otro tenant / id
  // malformado" ANTES de mirar la tabla de transiciones (mismo criterio 404 que GET).
  let entregaTipo
  try {
    entregaTipo = await getEntregaTipoPedido(guard.tenantId, id)
  } catch (err) {
    console.error("[admin/pedidos] no se pudo leer el tipo de entrega", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo actualizar el pedido. Inténtelo nuevamente.")
  }
  if (entregaTipo === null) return adminNotFoundResponse()

  // Forzada: se salta la regla "entregado no se cancela" de la tabla, pero un cancelado sigue siendo terminal.
  const transicionValida = forzar
    ? estadoEsperado !== "cancelado"
    : puedeTransicionar(estadoEsperado, estado, entregaTipo)
  if (!transicionValida) {
    return fail(422, "invalid_transition", mensajeTransicionInvalida(estadoEsperado, estado))
  }

  // El motivo sólo cuenta al cancelar; en cualquier otra transición se ignora (ni se valida).
  let motivoLimpio: string | null = null
  if (estado === "cancelado") {
    const recortado = typeof motivo === "string" ? motivo.trim() : ""
    if (recortado.length < MOTIVO_MIN) {
      return forzar
        ? fail(400, "reason_required", "Indique el motivo de la cancelación.")
        : fail(422, "reason_required", "Indique el motivo de la cancelación.")
    }
    if (recortado.length > MOTIVO_MAX) {
      return fail(422, "reason_too_long", `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`)
    }
    motivoLimpio = recortado
  }

  const now = new Date()
  let result
  try {
    result = await cambiarEstado(guard.tenantId, id, {
      esperado: estadoEsperado,
      nuevo: estado,
      motivo: motivoLimpio,
      actor: { id: guard.user.id, name: guard.user.name },
      now,
      forzar,
    })
  } catch (err) {
    console.error("[admin/pedidos] no se pudo cambiar el estado", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo actualizar el pedido. Inténtelo nuevamente.")
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "no_cancelable") {
    return fail(422, "not_cancelable", mensajeNoCancelable(result.motivo), { motivo: result.motivo })
  }
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
      ...(forzar ? { forzado: true } : {}),
      actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
      at: now.toISOString(),
    }),
  )

  const aviso = await avisarCambioEstadoPedido({
    tenantId: guard.tenantId,
    pedido: result.pedido,
    desde: estadoEsperado,
    hacia: estado,
    now,
  })
  logAviso("estado", { tenant: guard.tenantId, orderId: id }, aviso)

  return Response.json(toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios, result.historial, result.remito, { incluirCosto: canSeeCosts(guard.user.role), pagoManual: result.pagoManual,
    }), {
    headers: NO_STORE,
  })
}
