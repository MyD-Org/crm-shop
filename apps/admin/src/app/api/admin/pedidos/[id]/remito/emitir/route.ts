import { AlegraRateLimitError, AlegraHttpError, createRemission } from "@/lib/alegra"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { armarPreviewRemito, lineasParaAlegra, observacionesRemito, puedeEmitirRemito } from "@/lib/remito"
import {
  formatearNumeroPedido,
  getPedido,
  registrarRemitoEmitido,
  toPedidoDetalleDto,
  type PedidoRow,
} from "@/lib/pedidos-repo"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"

// "Emitir remito": crea el remito REAL en Alegra desde el pedido, en 0 (papel de depósito, no
// venta) y lo persiste. A diferencia de "Vincular remito existente" (el remito ya está en
// Alegra), acá el POST escribe. Sólo admin+ (`requireAdminPlus`).
//
//   GET  → preview (dry-run, sin escritura): líneas, avisos y si se puede emitir.
//   POST → confirma: crea el remito en Alegra y lo persiste. 200 = detalle completo.
//
// Remito único por pedido (decisión de la usuaria): la unicidad la garantiza la restricción de
// `shop.order_remitos.order_id` (ver pedidos-repo.ts, `insertarRemito`), así que una carrera
// entre dos POST casi simultáneos deja como mucho un remito huérfano en Alegra sin vincular acá
// — sin riesgo de stock ni de dinero (el remito es puramente informativo en Alegra, confirmado
// contra su ayuda, ver el comentario de `createRemission` en `lib/alegra.ts`).

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, code, ...extra }, { status, headers: NO_STORE })

const MSG = {
  cancelado: "Un pedido cancelado no admite un remito.",
  yaTiene: "El pedido ya tiene un remito registrado. Desvincúlelo antes de emitir otro.",
  conflicto: "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente.",
  limite: "Alegra está recibiendo demasiadas consultas. Inténtelo nuevamente en un minuto.",
  alegra: "Alegra no respondió bien. Inténtelo nuevamente en unos minutos.",
  sinConfig: "No se pudo consultar Alegra para esta empresa. Inténtelo nuevamente en unos minutos.",
  interno: "No se pudo emitir el remito. Inténtelo nuevamente.",
} as const

function chequeoPedido(pedido: PedidoRow, tieneRemito: boolean): Response | null {
  if (pedido.estado === "cancelado") return fail(422, "cancelado", MSG.cancelado)
  if (tieneRemito) return fail(409, "ya_vinculado", MSG.yaTiene)
  return null
}

async function configDe(tenantId: string): Promise<TenantConfig | null> {
  const config = await getTenantByIdFromDb(tenantId)
  if (!config) console.error(`[admin/pedidos/remito/emitir] sin config para tenant "${tenantId}"`)
  return config
}

function errorAlegra(err: unknown, ctx: Record<string, unknown>): Response {
  if (err instanceof AlegraRateLimitError) {
    console.warn("[admin/pedidos/remito/emitir] Alegra 429", ctx)
    return fail(503, "alegra_limite", MSG.limite)
  }
  console.error("[admin/pedidos/remito/emitir] Alegra respondió mal", { ...ctx, err })
  return fail(502, "alegra_error", MSG.alegra)
}

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const bloqueo = chequeoPedido(found.pedido, found.remito !== null)
    if (bloqueo) return bloqueo

    const preview = armarPreviewRemito(found.items)
    const { bloqueo: bloqueoContacto } = puedeEmitirRemito(found.pedido)
    const avisos = bloqueoContacto ? [...preview.avisos, bloqueoContacto] : preview.avisos

    return Response.json({ lineas: preview.lineas, avisos }, { headers: NO_STORE })
  } catch (err) {
    console.error("[admin/pedidos/remito/emitir] no se pudo preparar el preview", { tenant: guard.tenantId, orderId: id, err })
    return fail(500, "internal", "No se pudo preparar la vista previa. Inténtelo nuevamente.")
  }
}

export async function POST(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const ctx = { tenant: guard.tenantId, orderId: id }
  const now = new Date()
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const bloqueo = chequeoPedido(found.pedido, found.remito !== null)
    if (bloqueo) return bloqueo

    const { bloqueo: bloqueoContacto } = puedeEmitirRemito(found.pedido)
    if (bloqueoContacto) return fail(422, "sin_contacto", bloqueoContacto)

    const preview = armarPreviewRemito(found.items)
    if (preview.avisos.length > 0) return fail(422, "items_sin_alegra", preview.avisos[0])
    if (preview.lineas.length === 0) return fail(422, "sin_lineas", "El pedido no tiene ítems para remitir.")

    const config = await configDe(guard.tenantId)
    if (!config) return fail(500, "internal", MSG.sinConfig)

    let creado
    try {
      creado = await createRemission(config, {
        contactAlegraId: found.pedido.clienteCodigo as string,
        items: lineasParaAlegra(preview.lineas),
        observations: observacionesRemito(formatearNumeroPedido(found.pedido.numero), found.pedido.facturaNumero),
      })
    } catch (err) {
      if (err instanceof AlegraHttpError || err instanceof AlegraRateLimitError) return errorAlegra(err, ctx)
      throw err
    }

    const result = await registrarRemitoEmitido(guard.tenantId, id, {
      remito: { alegraId: creado.alegraId, numero: creado.number, fecha: creado.date },
      actor: { id: guard.user.id, name: guard.user.name },
      now,
    })

    if (result.kind === "not_found") return adminNotFoundResponse()
    if (result.kind === "cancelado") return fail(422, "cancelado", MSG.cancelado)
    if (result.kind === "conflict") {
      // El remito YA se creó en Alegra (`creado.alegraId`) pero no se pudo persistir (carrera,
      // o el pedido cambió entre el chequeo y el INSERT): se informa el id/número para que el
      // operador lo vincule a mano con "Vincular remito existente" — misma vía de recuperación
      // que usa "Emitir factura" cuando la persistencia falla después de crear en Alegra.
      console.error("[admin/pedidos/remito/emitir] remito creado en Alegra sin persistir", {
        ...ctx,
        alegraId: creado.alegraId,
        numero: creado.number,
      })
      return fail(
        409,
        "creado_sin_vincular",
        `El remito ${creado.number ?? creado.alegraId} se creó en Alegra pero no se pudo vincular al pedido. Use "Vincular remito existente" con ese número.`,
        { alegraId: creado.alegraId, numero: creado.number },
      )
    }

    console.info(
      JSON.stringify({
        event: "shop_order_remito_emitido",
        tenant: guard.tenantId,
        orderId: id,
        remitoAlegraId: creado.alegraId,
        actor: { id: guard.user.id, name: guard.user.name, email: guard.user.email },
        at: now.toISOString(),
      }),
    )
    return Response.json(
      toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios, result.historial, result.remito),
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[admin/pedidos/remito/emitir] no se pudo emitir el remito", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }
}
