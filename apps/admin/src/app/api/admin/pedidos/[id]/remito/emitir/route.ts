import { AlegraRateLimitError, AlegraHttpError, createRemission } from "@/lib/alegra"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { armarPreviewRemito, lineasParaAlegra, observacionesRemito, puedeEmitirRemito } from "@/lib/remito"
import { armarLineasFactura } from "@/lib/factura-emitir"
import { asegurarItemsEnCuenta } from "@/lib/alegra-items-cuenta"
import { contactoDelPedidoEnCuenta } from "@/lib/contacto-en-cuenta"
import {
  cargarContextoCuentaFactura,
  comoDestino,
  configDeCuentaRow,
  resolverParaPedido,
  MSG_SIN_CUENTA_FACTURA,
} from "@/lib/pedido-factura-cuenta-repo"
import {
  formatearNumeroPedido,
  getPedido,
  registrarRemitoEmitido,
  toPedidoDetalleDto,
  type PedidoRow,
} from "@/lib/pedidos-repo"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"
import { canSeeCosts } from "@/lib/roles"

// "Emitir remito": crea el remito REAL en Alegra desde el pedido, en 0 (papel de depósito, no
// venta) y lo persiste. A diferencia de "Vincular remito existente" (el remito ya está en
// Alegra), acá el POST escribe. Sólo admin+ (`requireAdminPlus`).
//
//   GET  → preview (dry-run, sin escritura): líneas, avisos y si se puede emitir.
//   POST → confirma: crea el remito en Alegra y lo persiste. 200 = detalle completo.
//
// Cuenta (change `sucursales-igz-mdp`, rebanada D): el remito se emite en la MISMA cuenta que la
// factura (la registrada al emitirla; si todavía no se facturó, la que corresponde al pedido). En una
// cuenta distinta de la principal el contacto se busca por documento o se crea (el `cliente_codigo`
// del pedido es un id de la principal) y los ítems se resuelven/crean en esa cuenta.
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

/** Cuenta del remito: la de la factura si ya se emitió por esta vía; si no, la calculada del pedido. */
async function cuentaDelRemito(tenantId: string, pedido: PedidoRow) {
  const ctx = await cargarContextoCuentaFactura(tenantId, pedido.id)
  const deLaFactura = ctx.fila?.facturaCuentaId ? ctx.cuentas.find((c) => c.id === ctx.fila?.facturaCuentaId) : undefined
  return deLaFactura ?? resolverParaPedido(pedido, ctx).cuenta
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
    const cuenta = await cuentaDelRemito(guard.tenantId, found.pedido)
    // Con la cuenta principal el remito reusa el contacto de la factura; en otra cuenta se busca o
    // se crea al emitir, así que `cliente_codigo` no es requisito.
    const { bloqueo: bloqueoContacto } = cuenta && !cuenta.principal ? { bloqueo: null } : puedeEmitirRemito(found.pedido)
    const avisos = [...preview.avisos, ...(bloqueoContacto ? [bloqueoContacto] : []), ...(cuenta ? [] : [MSG_SIN_CUENTA_FACTURA])]

    return Response.json(
      { lineas: preview.lineas, avisos, cuenta: cuenta ? { slug: cuenta.slug, nombre: cuenta.nombre } : null },
      { headers: NO_STORE },
    )
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

    const cuenta = await cuentaDelRemito(guard.tenantId, found.pedido)
    if (!cuenta) return fail(422, "sin_cuenta", MSG_SIN_CUENTA_FACTURA)

    if (cuenta.principal) {
      const { bloqueo: bloqueoContacto } = puedeEmitirRemito(found.pedido)
      if (bloqueoContacto) return fail(422, "sin_contacto", bloqueoContacto)
    }

    const preview = armarPreviewRemito(found.items)
    if (preview.avisos.length > 0) return fail(422, "items_sin_alegra", preview.avisos[0])
    if (preview.lineas.length === 0) return fail(422, "sin_lineas", "El pedido no tiene ítems para remitir.")

    const base = await configDe(guard.tenantId)
    if (!base) return fail(500, "internal", MSG.sinConfig)
    let config: TenantConfig
    try {
      config = configDeCuentaRow(base, cuenta)
    } catch (err) {
      return fail(422, "cuenta_sin_credenciales", err instanceof Error ? err.message : MSG.sinConfig)
    }

    // Ids reales de los ítems en la cuenta (se crean si no existen) y contacto de esa cuenta.
    let lineas = preview.lineas
    let contactoId: string
    try {
      const items = await asegurarItemsEnCuenta(guard.tenantId, config, comoDestino(cuenta), armarLineasFactura(found.items).lineas)
      if (!items.ok) return fail(422, "item_en_cuenta", items.error)
      lineas = lineas.map((l) => ({ ...l, alegraItemId: items.ids.get(l.alegraItemId) ?? l.alegraItemId }))
      const contacto = await contactoDelPedidoEnCuenta(config, found.pedido, cuenta.principal)
      if (!contacto) return fail(422, "sin_contacto", "El pedido no tiene datos para dar de alta al cliente en la cuenta de Alegra.")
      contactoId = contacto.alegraId
    } catch (err) {
      if (err instanceof AlegraHttpError || err instanceof AlegraRateLimitError) return errorAlegra(err, ctx)
      throw err
    }

    let creado
    try {
      creado = await createRemission(config, {
        contactAlegraId: contactoId,
        items: lineasParaAlegra(lineas),
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
      toPedidoDetalleDto(result.pedido, result.items, result.listaPrecios, result.historial, result.remito, {
      incluirCosto: canSeeCosts(guard.user.role),
    }),
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[admin/pedidos/remito/emitir] no se pudo emitir el remito", { ...ctx, err })
    return fail(500, "internal", MSG.interno)
  }
}
