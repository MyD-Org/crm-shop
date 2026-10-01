import { AlegraRateLimitError, buscarRemisionesPorNumero, getRemisionPorId, type AlegraRemisionResumen } from "@/lib/alegra"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { nombreDocumentoAlegra, resolverRemito, validarRemision } from "@/lib/remito"
import { desvincularRemito, getPedido, toPedidoDetalleDto, vincularRemito, type PedidoRow, type RemitoResult } from "@/lib/pedidos-repo"
import { configAlegraDelPedido } from "@/lib/pedido-cuenta-alegra"
import { canSeeCosts } from "@/lib/roles"

// "Vincular remito existente" del detalle de pedido (rebanada D, remito único por pedido).
//
//   GET    /api/admin/pedidos/[id]/remito?numero=…  → busca el remito en Alegra, SIN guardar
//          nada: 200 { remision, clienteVerificado }.
//   POST   /api/admin/pedidos/[id]/remito { alegraId } → lo vuelve a leer de Alegra (no se
//          confía en lo que manda el navegador) y lo vincula al pedido. 200 = detalle completo.
//   DELETE /api/admin/pedidos/[id]/remito → desvincula (no toca Alegra: el remito sigue
//          existiendo allá).
//
// SÓLO admin+ (`requireAdminPlus`, a diferencia de "vincular factura" que es operator+): el
// remito, igual que "Emitir factura", es una acción del dominio de facturación/depósito, no del
// día a día del operador de mostrador. Pedido inexistente, ajeno o con id malformado → 404.
//
// A diferencia de la factura, un remito NO manda mail al cliente: es un papel de depósito, no
// algo que el comprador necesite recibir.

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "private, no-store" }
const NUMERO_MAX = 60

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, code, ...extra }, { status, headers: NO_STORE })

const MSG = {
  numero: "Ingrese el número o el enlace del remito, tal como figura en Alegra.",
  alegraId: "Indique el remito a vincular.",
  cancelado: "Un pedido cancelado no admite un remito vinculado.",
  yaVinculado: "El pedido ya tiene un remito registrado. Desvincúlelo antes de vincular otro.",
  conflicto: "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente.",
  noEncontrado: "No encontramos ese remito en Alegra. Verifique el número e inténtelo nuevamente.",
  ambiguo: "Hay más de un remito con ese número en Alegra. Ingrese el número completo, con el punto de venta.",
  urlOtroDocumento: (documento: string) =>
    `Ese enlace corresponde a ${nombreDocumentoAlegra(documento)} de Alegra, no a un remito. Ingrese el número o el enlace del remito.`,
  limite: "Alegra está recibiendo demasiadas consultas. Inténtelo nuevamente en un minuto.",
  alegra: "Alegra no respondió bien. Inténtelo nuevamente en unos minutos.",
  interno: "No se pudo actualizar el pedido. Inténtelo nuevamente.",
} as const

const remisionDto = (r: AlegraRemisionResumen) => ({
  alegraId: r.alegraId,
  numero: r.numero,
  fecha: r.fecha,
  clienteNombre: r.clienteNombre,
})

/** 404 / 422 / 409 según el pedido, antes de ir a Alegra. `null` = se puede seguir. */
function chequeoPedido(pedido: PedidoRow, tieneRemito: boolean): Response | null {
  if (pedido.estado === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (tieneRemito) return fail(409, "ya_vinculado", MSG.yaVinculado)
  return null
}

function errorAlegra(err: unknown, ctx: Record<string, unknown>): Response {
  if (err instanceof AlegraRateLimitError) {
    console.warn("[admin/pedidos/remito] Alegra 429", ctx)
    return fail(503, "alegra_limite", MSG.limite)
  }
  console.error("[admin/pedidos/remito] Alegra respondió mal", { ...ctx, err })
  return fail(502, "alegra_error", MSG.alegra)
}

function respuestaResultado(result: RemitoResult, incluirCosto: boolean): Response {
  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (result.kind === "conflict") return fail(409, "conflict", MSG.conflicto)
  return Response.json(
    toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios, result.historial, result.remito, { incluirCosto, pagoManual: result.pagoManual }),
    { headers: NO_STORE },
  )
}

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const numero = (new URL(req.url).searchParams.get("numero") ?? "").trim()
  if (!numero || numero.length > NUMERO_MAX || !/[0-9A-Za-z]/.test(numero)) return fail(400, "invalid", MSG.numero)

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const bloqueo = chequeoPedido(found.pedido, found.remito !== null)
    if (bloqueo) return bloqueo

    const cfg = await configAlegraDelPedido(guard.tenantId, found.pedido)
    if (!cfg.ok) return fail(cfg.status, cfg.code, cfg.error)
    const config = cfg.config

    const clienteCodigo = found.pedido.clienteCodigo
    let resultado
    try {
      resultado = await resolverRemito(numero, clienteCodigo, {
        porNumero: (n, o) => buscarRemisionesPorNumero(config, n, o),
        porId: (alegraId) => getRemisionPorId(config, alegraId),
      })
    } catch (err) {
      return errorAlegra(err, ctx)
    }
    if (resultado.kind === "no_encontrado") return fail(422, "remito_no_encontrado", MSG.noEncontrado)
    if (resultado.kind === "ambiguo") return fail(422, "remito_ambiguo", MSG.ambiguo)
    if (resultado.kind === "url_otro_documento") {
      return fail(422, "remito_url_otro_documento", MSG.urlOtroDocumento(resultado.documento))
    }

    const validacion = validarRemision(resultado.remision, clienteCodigo)
    return Response.json(
      { remision: remisionDto(resultado.remision), clienteVerificado: validacion.clienteVerificado },
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[admin/pedidos/remito] no se pudo buscar el remito", { ...ctx, err })
    return fail(500, "internal", "No se pudo buscar el remito. Inténtelo nuevamente.")
  }
}

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const alegraId =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).alegraId
      : undefined
  if (typeof alegraId !== "string" || !alegraId.trim() || alegraId.length > NUMERO_MAX) {
    return fail(400, "invalid", MSG.alegraId)
  }

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  const now = new Date()
  let result: RemitoResult
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const bloqueo = chequeoPedido(found.pedido, found.remito !== null)
    if (bloqueo) return bloqueo

    const cfg = await configAlegraDelPedido(guard.tenantId, found.pedido)
    if (!cfg.ok) return fail(cfg.status, cfg.code, cfg.error)
    const config = cfg.config

    let remision: AlegraRemisionResumen | null
    try {
      remision = await getRemisionPorId(config, alegraId)
    } catch (err) {
      return errorAlegra(err, ctx)
    }
    if (!remision) return fail(422, "remito_no_encontrado", MSG.noEncontrado)

    result = await vincularRemito(guard.tenantId, id, {
      remito: { alegraId: remision.alegraId, numero: remision.numero, fecha: remision.fecha },
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })
  } catch (err) {
    console.error("[admin/pedidos/remito] no se pudo vincular el remito", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }

  if (result.kind === "ok") {
    console.info(
      JSON.stringify({
        event: "shop_order_remito_vinculado",
        tenant: guard.tenantId,
        orderId: id,
        actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
        at: now.toISOString(),
      }),
    )
  }
  return respuestaResultado(result, canSeeCosts(guard.user.role))
}

export async function DELETE(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const now = new Date()
  let result: RemitoResult
  try {
    result = await desvincularRemito(guard.tenantId, id, {
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })
  } catch (err) {
    console.error("[admin/pedidos/remito] no se pudo desvincular el remito", {
      tenant: guard.tenantId,
      orderId: id,
      err,
    })
    return fail(500, "internal", MSG.interno)
  }
  if (result.kind === "ok") {
    console.info(
      JSON.stringify({
        event: "shop_order_remito_desvinculado",
        tenant: guard.tenantId,
        orderId: id,
        actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
        at: now.toISOString(),
      }),
    )
  }
  return respuestaResultado(result, canSeeCosts(guard.user.role))
}
