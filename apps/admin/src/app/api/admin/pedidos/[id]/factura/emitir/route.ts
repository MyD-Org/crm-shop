import {
  AlegraHttpError,
  AlegraRateLimitError,
  createInvoice,
  findContactByIdentifier,
  listNumberTemplates,
  listTaxes,
  type AlegraInvoiceCreateInput,
} from "@/lib/alegra"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { crearContacto } from "@/lib/contactos"
import {
  armarLineasFactura,
  puedeEmitir,
  resolverItemsAlegra,
  resolverPreviewEmision,
  validarNumeracionElegida,
} from "@/lib/factura-emitir"
import { enviarFacturaPedido, logAvisoFactura, type AvisoFactura } from "@/lib/pedido-factura-aviso"
import {
  estadoReservaEmision,
  getPedido,
  liberarReservaEmisionFactura,
  persistirFacturaEmitida,
  reservarEmisionFactura,
  toPedidoDetalleDto,
  type FacturaResult,
  type PedidoItemRow,
  type PedidoRow,
} from "@/lib/pedidos-repo"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"

// "Emitir factura" del detalle de pedido. Endpoint y acción de UI separados de "Vincular
// factura" (.../factura/route.ts): acá se CREA la factura real en Alegra (dinero real e
// irreversible), no se vincula una ya emitida a mano por fuera.
//
//   GET  /api/admin/pedidos/[id]/factura/emitir → preview (dry-run): líneas, total, contacto a
//   usar, numeraciones de factura activas + sugerida, y bloqueo/avisos si no se puede emitir.
//   NUNCA escribe: ni en Alegra ni en la base.
//
//   POST /api/admin/pedidos/[id]/factura/emitir { numberTemplateId } → confirma: revalida la
//   numeración y el bloqueo por IVA SERVER-SIDE (nunca confía en lo que mostró el preview),
//   resuelve o crea el contacto, crea la factura en Alegra (`createInvoice`) y persiste el
//   vínculo con el evento 'factura_emitida' del historial. 200 = detalle + `avisoFactura`.
//
// Permiso `requireAdminPlus` (no `requireOperatorPlus`, a diferencia de "vincular") en los dos
// verbos: emitir crea dinero real e irreversible en Alegra, aunque el GET sólo lea.
//
// Concurrencia: dos POST casi simultáneos sobre el mismo pedido no pueden terminar en DOS
// facturas de Alegra. El UPDATE condicional que usa "vincular" (después de leer la factura) no
// alcanza acá porque la escritura en Alegra la hace ESTE endpoint: por eso el POST reserva el
// pedido (`reservarEmisionFactura`, mismo patrón de UPDATE atómico) ANTES de llamar a
// `createInvoice`. Ver el comentario de `pedidos-repo.ts` sobre el costo transitorio de esto
// (el pedido se ve "facturado" mientras dura la llamada a Alegra).

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "private, no-store" }
const NUMBER_TEMPLATE_ID_MAX = 60

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, code, ...extra }, { status, headers: NO_STORE })

const MSG = {
  yaFacturado: "El pedido ya tiene una factura vinculada.",
  cancelado: "Un pedido cancelado no admite una factura.",
  sinConfig: "No se pudo consultar Alegra para esta empresa. Inténtelo nuevamente en unos minutos.",
  limite: "Alegra está recibiendo demasiadas consultas. Inténtelo nuevamente en un minuto.",
  alegra: "Alegra no respondió bien. Inténtelo nuevamente en unos minutos.",
  interno: "No se pudo armar la vista previa de la factura. Inténtelo nuevamente.",
  numeracionInvalida:
    "La numeración seleccionada ya no está disponible. Vuelva a abrir la vista previa e inténtelo nuevamente.",
  numeracionRequerida: "Seleccione una numeración para emitir la factura.",
  conflicto: "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente.",
  emisionEnCurso: "Hay una emisión de esta factura en curso. Espere unos segundos y actualice la página.",
  interno_confirmar: "No se pudo emitir la factura. Inténtelo nuevamente.",
  creadaSinVincular: (alegraId: string, numero: string | null) =>
    `La factura se creó en Alegra${numero ? ` (número ${numero})` : ` (id ${alegraId})`}, pero no se pudo vincular ` +
    'al pedido automáticamente. Use "Vincular factura" con ese número para completar el vínculo.',
} as const

function errorAlegra(err: unknown, ctx: Record<string, unknown>): Response {
  if (err instanceof AlegraRateLimitError) {
    console.warn("[admin/pedidos/factura/emitir] Alegra 429", ctx)
    return fail(503, "alegra_limite", MSG.limite)
  }
  console.error("[admin/pedidos/factura/emitir] Alegra respondió mal", { ...ctx, err })
  return fail(502, "alegra_error", MSG.alegra)
}

/**
 * Chequeo de idempotencia común a GET y POST, consciente de la reserva de emisión (ver
 * `estadoReservaEmision` en pedidos-repo.ts): una factura REAL, o una reserva VIGENTE (emisión en
 * curso), bloquean; una reserva VENCIDA (la corrida anterior murió a mitad de camino: timeout,
 * crash, deploy) se trata como si el pedido no tuviera factura, para que se pueda reintentar.
 * `null` = seguir adelante.
 */
function chequeoFacturaExistente(pedido: PedidoRow): Response | null {
  if (!pedido.facturaAlegraId) return null
  const estado = estadoReservaEmision(pedido)
  if (estado === "vencida") return null
  if (estado === "vigente") return fail(409, "emision_en_curso", MSG.emisionEnCurso)
  return fail(409, "ya_vinculada", MSG.yaFacturado)
}

async function configDe(tenantId: string): Promise<TenantConfig | null> {
  const config = await getTenantByIdFromDb(tenantId)
  if (!config) console.error(`[admin/pedidos/factura/emitir] sin config para tenant "${tenantId}"`)
  return config
}

type IdParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    // Idempotencia: un pedido ya facturado (emitido o vinculado a mano) no vuelve a mostrar un
    // preview de emisión; una emisión VIGENTE tampoco (hay una en curso); una VENCIDA sí deja
    // seguir, como si no tuviera factura (ver `chequeoFacturaExistente`).
    const bloqueo = chequeoFacturaExistente(found.pedido)
    if (bloqueo) return bloqueo

    const config = await configDe(guard.tenantId)
    if (!config) return fail(500, "internal", MSG.sinConfig)

    let preview
    try {
      preview = await resolverPreviewEmision(found.pedido, found.items, {
        listNumberTemplates: () => listNumberTemplates(config),
        findContactByIdentifier: (documento) => findContactByIdentifier(config, documento),
        listTaxes: () => listTaxes(config),
      })
    } catch (err) {
      return errorAlegra(err, ctx)
    }
    return Response.json(preview, { headers: NO_STORE })
  } catch (err) {
    console.error("[admin/pedidos/factura/emitir] no se pudo armar el preview", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }
}

function respuestaResultado(result: FacturaResult, aviso?: AvisoFactura): Response {
  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (result.kind === "conflict") return fail(409, "ya_vinculada", MSG.yaFacturado)
  const detalle = toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios, result.historial)
  const body = aviso ? { ...detalle, avisoFactura: { resultado: aviso.resultado, destino: aviso.destino } } : detalle
  return Response.json(body, { headers: NO_STORE })
}

/** Nombre a usar si hay que crear el contacto: razón social de facturación, o el del contacto del pedido. */
function nombreParaContacto(pedido: PedidoRow): string {
  return pedido.facturacionRazonSocial?.trim() || pedido.contactoNombre
}

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const numberTemplateId =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).numberTemplateId
      : undefined
  if (typeof numberTemplateId !== "string" || !numberTemplateId.trim() || numberTemplateId.length > NUMBER_TEMPLATE_ID_MAX) {
    return fail(400, "invalid", MSG.numeracionRequerida)
  }

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  const now = new Date()
  const actor = { id: guard.user.id, name: guard.user.name }

  let pedido: PedidoRow
  let items: PedidoItemRow[]
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    pedido = found.pedido
    items = found.items
  } catch (err) {
    console.error("[admin/pedidos/factura/emitir] no se pudo leer el pedido", { ...ctx, err })
    return fail(500, "internal", MSG.interno_confirmar)
  }

  // Idempotencia: ya facturado o con una emisión vigente, antes de gastar cuota de Alegra. Una
  // reserva vencida deja seguir (`reservarEmisionFactura` la retoma más abajo).
  const bloqueoExistente = chequeoFacturaExistente(pedido)
  if (bloqueoExistente) return bloqueoExistente
  if (pedido.estado === "cancelado") return fail(422, "cancelado", MSG.cancelado)

  const config = await configDe(guard.tenantId)
  if (!config) return fail(500, "internal", MSG.sinConfig)

  // ── Validaciones server-side, TODAS antes de tocar Alegra con una escritura ──
  let numeraciones
  try {
    numeraciones = await listNumberTemplates(config)
  } catch (err) {
    return errorAlegra(err, ctx)
  }
  if (!validarNumeracionElegida(numberTemplateId, numeraciones)) {
    return fail(422, "numeracion_invalida", MSG.numeracionInvalida)
  }
  const numeracionElegida = numeraciones.find((n) => n.alegraId === numberTemplateId)!

  const { bloqueo } = puedeEmitir(pedido, numeracionElegida)
  if (bloqueo) return fail(422, bloqueo.motivo, bloqueo.detalle)

  let taxes
  try {
    taxes = await listTaxes(config)
  } catch (err) {
    return errorAlegra(err, ctx)
  }

  let preview
  try {
    preview = await resolverPreviewEmision(pedido, items, {
      listNumberTemplates: async () => numeraciones,
      findContactByIdentifier: (documento) => findContactByIdentifier(config, documento),
      listTaxes: async () => taxes,
    })
  } catch (err) {
    return errorAlegra(err, ctx)
  }
  if (preview.avisos.length > 0) {
    const primero = preview.avisos[0]
    return fail(422, primero.motivo, primero.detalle)
  }

  const { lineas } = armarLineasFactura(items)
  const { items: itemsAlegra, avisos: avisosImpuestos } = resolverItemsAlegra(lineas, taxes)
  if (avisosImpuestos.length > 0) {
    return fail(422, avisosImpuestos[0].motivo, avisosImpuestos[0].detalle)
  }

  // ── Reserva atómica: recién de acá para adelante se puede llegar a escribir en Alegra ──
  const reserva = await reservarEmisionFactura(guard.tenantId, id, { actor, now })
  if (reserva.kind === "not_found") return adminNotFoundResponse()
  if (reserva.kind === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (reserva.kind === "conflict") return fail(409, "ya_vinculada", MSG.yaFacturado)

  let contactoAlegraId = preview.contacto.alegraId
  try {
    if (preview.contacto.esNuevo || !contactoAlegraId) {
      const creado = await crearContacto(config, {
        name: nombreParaContacto(pedido),
        identification: pedido.facturacionNroDoc?.trim() || undefined,
        email: pedido.clienteEmail?.trim() || undefined,
      })
      contactoAlegraId = creado.alegraId
    }
  } catch (err) {
    await liberarReservaEmisionFactura(guard.tenantId, id)
    return errorAlegra(err, ctx)
  }

  const createInput: AlegraInvoiceCreateInput = {
    contactAlegraId: contactoAlegraId,
    items: itemsAlegra,
    numberTemplate: { id: numberTemplateId },
  }

  let creada
  try {
    creada = await createInvoice(config, createInput)
  } catch (err) {
    await liberarReservaEmisionFactura(guard.tenantId, id)
    if (err instanceof AlegraRateLimitError) {
      console.warn("[admin/pedidos/factura/emitir] Alegra 429 al crear la factura", ctx)
      return fail(503, "alegra_limite", MSG.limite)
    }
    if (err instanceof AlegraHttpError) {
      console.error("[admin/pedidos/factura/emitir] Alegra rechazó la factura", { ...ctx, err })
      return fail(502, "alegra_error", MSG.alegra)
    }
    console.error("[admin/pedidos/factura/emitir] error inesperado al crear la factura", { ...ctx, err })
    return fail(500, "internal", MSG.interno_confirmar)
  }

  console.info(
    JSON.stringify({
      event: "shop_order_factura_emitida",
      tenant: guard.tenantId,
      orderId: id,
      facturaAlegraId: creada.alegraId,
      actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
      at: now.toISOString(),
    }),
  )

  let result: FacturaResult
  try {
    result = await persistirFacturaEmitida(guard.tenantId, id, {
      factura: { alegraId: creada.alegraId, numero: creada.number, fecha: creada.date, total: creada.total },
      actor,
      now,
    })
  } catch (err) {
    // La factura YA existe en Alegra: no se reintenta acá (podría ocultar un fallo de DB real
    // detrás de un 200 que no refleja el estado verdadero). Se libera la reserva (vuelve a
    // `factura_alegra_id = NULL`) para que "Vincular factura" pueda usarse de inmediato con el
    // número/id que Alegra devolvió — si se dejara el sentinel puesto, "vincular" lo vería como
    // "el pedido ya tiene otra factura" y bloquearía justo la vía de recuperación que se ofrece.
    console.error("[admin/pedidos/factura/emitir] la factura se creó en Alegra pero no se pudo persistir el vínculo", {
      ...ctx,
      alegraId: creada.alegraId,
      numero: creada.number,
      err,
    })
    await liberarReservaEmisionFactura(guard.tenantId, id)
    return fail(502, "creada_sin_vincular", MSG.creadaSinVincular(creada.alegraId, creada.number), {
      alegraId: creada.alegraId,
      numero: creada.number,
    })
  }

  if (result.kind === "conflict") {
    // La reserva se perdió entre crear la factura y persistir el vínculo (no debería pasar:
    // nadie más puede tocar la fila mientras está reservada). Mismo tratamiento que arriba.
    console.error("[admin/pedidos/factura/emitir] se perdió la reserva antes de persistir el vínculo", {
      ...ctx,
      alegraId: creada.alegraId,
      numero: creada.number,
    })
    return fail(502, "creada_sin_vincular", MSG.creadaSinVincular(creada.alegraId, creada.number), {
      alegraId: creada.alegraId,
      numero: creada.number,
    })
  }
  if (result.kind === "not_found" || result.kind === "cancelado") {
    // Igual de improbable que el caso anterior (la reserva ya validó que el pedido existía y no
    // estaba cancelado): mismo tratamiento informativo, nunca un 500 mudo.
    console.error("[admin/pedidos/factura/emitir] estado inesperado al persistir el vínculo", {
      ...ctx,
      alegraId: creada.alegraId,
      numero: creada.number,
      kind: result.kind,
    })
    return fail(502, "creada_sin_vincular", MSG.creadaSinVincular(creada.alegraId, creada.number), {
      alegraId: creada.alegraId,
      numero: creada.number,
    })
  }

  const aviso = await enviarFacturaPedido({ tenantId: guard.tenantId, pedido: result.pedido })
  logAvisoFactura(ctx, aviso)
  return respuestaResultado(result, aviso)
}
