import {
  AlegraRateLimitError,
  buscarFacturasPorNumero,
  getFacturaPorId,
  type AlegraFacturaResumen,
} from "@/lib/alegra"
import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { nombreDocumentoAlegra, resolverFactura, validarFactura, type MotivoFacturaInvalida } from "@/lib/factura-vincular"
import { enviarFacturaPedido, logAvisoFactura, type AvisoFactura } from "@/lib/pedido-factura-aviso"
import {
  desvincularFactura,
  estadoReservaEmision,
  getPedido,
  pedidosConFactura,
  toPedidoDetalleDto,
  vincularFactura,
  type FacturaResult,
  type PedidoRow,
} from "@/lib/pedidos-repo"
import { configAlegraDelPedido } from "@/lib/pedido-cuenta-alegra"
import { canSeeCosts } from "@/lib/roles"

// "Vincular factura" del detalle de pedido (change webhooks-stock-alegra, PR-3b).
//
//   GET    /api/admin/pedidos/[id]/factura?numero=…  → busca la factura en Alegra y la valida
//          contra el pedido, SIN guardar nada: 200 { factura, clienteVerificado, otrosPedidos }.
//   POST   /api/admin/pedidos/[id]/factura  { alegraId } → la vuelve a leer de Alegra (no se
//          confía en lo que manda el navegador), revalida y la vincula: marca el pedido como
//          facturado y libera su reserva de stock. 200 = detalle completo + `avisoFactura`
//          (resultado del mail "Su factura" con el PDF, sólo cuando el vínculo es nuevo).
//   DELETE /api/admin/pedidos/[id]/factura?alegraId=… → desvincula y quita la marca. `alegraId`
//          (opcional) = la que el operador tenía en pantalla: si ahora hay otra → 409.
//
// Mismo guard que el cambio de estado (operator | admin | superadmin); el tenant sale del
// guard. Pedido inexistente, ajeno o con id malformado → el mismo 404. Ninguna de las tres
// cambia el estado del pedido. Sólo el POST le escribe al cliente: le manda la factura.
//
// Orden de chequeos de GET/POST: guard → payload (400) → pedido (404 / 422 cancelado / 409 ya
// tiene otra factura) → Alegra (503 si nos frena, 502 si falla) → factura (422) → UPDATE.
// Así un pedido que no puede vincularse no gasta cuota de Alegra.

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "private, no-store" }
const NUMERO_MAX = 60

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, code, ...extra }, { status, headers: NO_STORE })

const MSG = {
  numero: "Ingrese el número o el enlace de la factura, tal como figura en Alegra.",
  alegraId: "Indique la factura a vincular.",
  cancelado: "Un pedido cancelado no admite una factura vinculada.",
  yaVinculada: "El pedido ya tiene una factura vinculada. Desvincúlela antes de vincular otra.",
  emisionEnCurso: "Hay una emisión de esta factura en curso. Espere unos segundos e inténtelo nuevamente.",
  conflicto: "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente.",
  noEncontrada: "No encontramos esa factura en Alegra. Verifique el número e inténtelo nuevamente.",
  ambigua: "Hay más de una factura con ese número en Alegra. Ingrese el número completo, con el punto de venta.",
  urlOtroDocumento: (documento: string) =>
    `Ese enlace corresponde a ${nombreDocumentoAlegra(documento)} de Alegra, no a una factura. Ingrese el número o el enlace de la factura.`,
  limite: "Alegra está recibiendo demasiadas consultas. Inténtelo nuevamente en un minuto.",
  alegra: "Alegra no respondió bien. Inténtelo nuevamente en unos minutos.",
  interno: "No se pudo actualizar el pedido. Inténtelo nuevamente.",
} as const

function mensajeInvalida(motivo: MotivoFacturaInvalida, factura: AlegraFacturaResumen): string {
  if (motivo === "borrador") return "La factura está en borrador en Alegra. Emítala antes de vincularla."
  if (motivo === "anulada") return "La factura está anulada en Alegra y no se puede vincular."
  const de = factura.clienteNombre ? ` (${factura.clienteNombre})` : ""
  return `La factura es de otro cliente${de}. Verifique el número.`
}

const facturaDto = (f: AlegraFacturaResumen) => ({
  alegraId: f.alegraId,
  numero: f.numero,
  fecha: f.fecha,
  total: f.total,
  estado: f.estado,
  clienteNombre: f.clienteNombre,
})

/**
 * 404 / 422 / 409 según el pedido, antes de ir a Alegra. `null` = se puede seguir.
 *
 * Una reserva de "Emitir factura" (ver `estadoReservaEmision` en pedidos-repo.ts) cuenta como
 * "ya tiene factura" SÓLO si está VIGENTE (hay una emisión en curso, no se puede vincular por
 * encima). Si está VENCIDA (la emisión anterior murió a mitad de camino: timeout, crash,
 * deploy), se trata como si el pedido no tuviera factura — es justo la vía de recuperación que
 * ofrece el mensaje de error de la emisión ("use Vincular factura").
 */
function chequeoPedido(pedido: PedidoRow, alegraId?: string): Response | null {
  if (pedido.estado === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (pedido.facturaAlegraId && pedido.facturaAlegraId !== alegraId) {
    const estadoReserva = estadoReservaEmision(pedido)
    if (estadoReserva === "vencida") return null
    if (estadoReserva === "vigente") return fail(409, "emision_en_curso", MSG.emisionEnCurso)
    return fail(409, "ya_vinculada", MSG.yaVinculada)
  }
  return null
}

function errorAlegra(err: unknown, ctx: Record<string, unknown>): Response {
  if (err instanceof AlegraRateLimitError) {
    console.warn("[admin/pedidos/factura] Alegra 429", ctx)
    return fail(503, "alegra_limite", MSG.limite)
  }
  console.error("[admin/pedidos/factura] Alegra respondió mal", { ...ctx, err })
  return fail(502, "alegra_error", MSG.alegra)
}

function respuestaResultado(result: FacturaResult, incluirCosto: boolean, aviso?: AvisoFactura): Response {
  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (result.kind === "conflict") return fail(409, "conflict", MSG.conflicto)
  const detalle = toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios, result.historial, result.remito, { incluirCosto, pagoManual: result.pagoManual })
  // `avisoFactura` va aparte del detalle: el componente lo saca antes de guardar el pedido.
  const body = aviso ? { ...detalle, avisoFactura: { resultado: aviso.resultado, destino: aviso.destino } } : detalle
  return Response.json(body, { headers: NO_STORE })
}

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const numero = (new URL(req.url).searchParams.get("numero") ?? "").trim()
  if (!numero || numero.length > NUMERO_MAX || !/[0-9A-Za-z]/.test(numero)) return fail(400, "invalid", MSG.numero)

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const bloqueo = chequeoPedido(found.pedido)
    if (bloqueo) return bloqueo

    const cfg = await configAlegraDelPedido(guard.tenantId, found.pedido)
    if (!cfg.ok) return fail(cfg.status, cfg.code, cfg.error)
    const config = cfg.config

    const clienteCodigo = found.pedido.clienteCodigo
    let resultado
    try {
      resultado = await resolverFactura(numero, clienteCodigo, {
        porNumero: (n, o) => buscarFacturasPorNumero(config, n, o),
        porId: (alegraId) => getFacturaPorId(config, alegraId),
      })
    } catch (err) {
      return errorAlegra(err, ctx)
    }
    if (resultado.kind === "no_encontrada") return fail(422, "factura_no_encontrada", MSG.noEncontrada)
    if (resultado.kind === "ambigua") return fail(422, "factura_ambigua", MSG.ambigua)
    if (resultado.kind === "url_otro_documento") {
      return fail(422, "factura_url_otro_documento", MSG.urlOtroDocumento(resultado.documento))
    }

    const factura = resultado.factura
    const validacion = validarFactura(factura, clienteCodigo)
    if (!validacion.ok) {
      return fail(422, `factura_${validacion.motivo}`, mensajeInvalida(validacion.motivo, factura))
    }
    const otrosPedidos = await pedidosConFactura(guard.tenantId, factura.alegraId, found.pedido.id)
    return Response.json(
      { factura: facturaDto(factura), clienteVerificado: validacion.clienteVerificado, otrosPedidos },
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[admin/pedidos/factura] no se pudo buscar la factura", { ...ctx, err })
    return fail(500, "internal", "No se pudo buscar la factura. Inténtelo nuevamente.")
  }
}

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  // Del body se lee SÓLO `alegraId`. Actor y tenant salen del guard.
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
  let result: FacturaResult
  let factura: AlegraFacturaResumen | null
  let yaVinculada = false
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const bloqueo = chequeoPedido(found.pedido, alegraId)
    if (bloqueo) return bloqueo
    yaVinculada = found.pedido.facturaAlegraId === alegraId

    const cfg = await configAlegraDelPedido(guard.tenantId, found.pedido)
    if (!cfg.ok) return fail(cfg.status, cfg.code, cfg.error)
    const config = cfg.config

    try {
      factura = await getFacturaPorId(config, alegraId)
    } catch (err) {
      return errorAlegra(err, ctx)
    }
    if (!factura) return fail(422, "factura_no_encontrada", MSG.noEncontrada)
    const validacion = validarFactura(factura, found.pedido.clienteCodigo)
    if (!validacion.ok) {
      return fail(422, `factura_${validacion.motivo}`, mensajeInvalida(validacion.motivo, factura))
    }

    result = await vincularFactura(guard.tenantId, id, {
      factura: { alegraId: factura.alegraId, numero: factura.numero, fecha: factura.fecha, total: factura.total },
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })
  } catch (err) {
    console.error("[admin/pedidos/factura] no se pudo vincular la factura", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }

  if (result.kind === "conflict") return fail(409, "ya_vinculada", MSG.yaVinculada)
  let aviso: AvisoFactura | undefined
  if (result.kind === "ok") {
    // Sin datos del cliente: ids, número de factura y actor.
    console.info(
      JSON.stringify({
        event: "shop_order_factura_vinculada",
        tenant: guard.tenantId,
        orderId: id,
        facturaAlegraId: factura.alegraId,
        actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
        at: now.toISOString(),
      }),
    )
    // Mail "Su factura" con el PDF, después de persistir. Repetir el POST con la misma factura
    // no lo vuelve a mandar (para eso está "Reenviar factura"); dos POST simultáneos sí lo
    // intentan, y la clave de idempotencia de Resend deja salir uno solo.
    if (!yaVinculada) {
      aviso = await enviarFacturaPedido({ tenantId: guard.tenantId, pedido: result.pedido })
      logAvisoFactura(ctx, aviso)
    }
  }
  return respuestaResultado(result, canSeeCosts(guard.user.role), aviso)
}

export async function DELETE(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const esperada = (new URL(req.url).searchParams.get("alegraId") ?? "").trim() || null
  const { id } = await params
  const now = new Date()
  let result: FacturaResult
  try {
    result = await desvincularFactura(guard.tenantId, id, {
      esperada,
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })
  } catch (err) {
    console.error("[admin/pedidos/factura] no se pudo desvincular la factura", {
      tenant: guard.tenantId,
      orderId: id,
      err,
    })
    return fail(500, "internal", MSG.interno)
  }
  if (result.kind === "ok") {
    console.info(
      JSON.stringify({
        event: "shop_order_factura_desvinculada",
        tenant: guard.tenantId,
        orderId: id,
        actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
        at: now.toISOString(),
      }),
    )
  }
  return respuestaResultado(result, canSeeCosts(guard.user.role))
}
