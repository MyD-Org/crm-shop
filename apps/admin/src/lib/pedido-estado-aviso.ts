// Envío del mail al cliente del Shop cuando cambia su pedido (estado o pago). Se llama DESPUÉS
// de persistir el cambio y NUNCA tira: si el mail no sale, el cambio ya quedó y el cliente igual
// lo ve en "Mis pedidos". El resultado sólo se loguea.

import { sendEmail } from "@/lib/email"
import { buildPedidoEstadoEmail, seAvisaTransicion, type AvisoPedido } from "@/lib/pedido-estado-email"
import { formatearNumeroPedido, type PedidoRow } from "@/lib/pedidos-repo"
import type { EstadoPedido } from "@/lib/pedidos-transiciones"
import { tokenLinkPago } from "@/lib/pedido-link"
import { urlPublicaShopParaPedido } from "@/lib/shop-destino"
import { getTenantByIdFromDb } from "@/lib/tenants"
import { marcaParaSitio } from "@/lib/marca-sitio"

export type AvisoResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }

const PATH_PEDIDOS = "/mi-cuenta/pedidos"

export function looksLikeEmail(s: string | null): s is string {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

/**
 * Link absoluto a "Mis pedidos" de la tienda donde se hizo el pedido (`sitioOrigen`), o la
 * principal del tenant si no consta; null si no tiene (ver shop-destino.ts).
 */
export function pedidosUrl(
  tenant: { id: string; shopUrl?: string; shopInternalUrl?: string; shopDestinosExtra?: unknown },
  sitioOrigen?: string | null,
): string | null {
  const base = urlPublicaShopParaPedido(tenant, sitioOrigen, process.env)
  return base ? `${base}${PATH_PEDIDOS}` : null
}

/** Medios que se cobran en línea (`pago_metodo`); los mismos que `PROCESADOR_DE_MEDIO` del Shop. */
const PAGO_METODOS_EN_LINEA = ["mercadopago", "payway"]

/** Pedido de invitado SIN cuenta: ya reclamado (`clerk_user_id`) o con cliente vinculado, es de una cuenta. */
export function esPedidoDeInvitado(p: Pick<PedidoRow, "compraInvitado" | "clerkUserId" | "clienteCodigo">): boolean {
  return p.compraInvitado && !p.clerkUserId && !p.clienteCodigo
}

/**
 * Datos del mail de un pedido de invitado: «Pagar su pedido» (link firmado al Shop, sólo si sigue
 * pendiente de pago en línea y el aviso no es el del pago ni la cancelación; sin `PEDIDO_LINK_SECRET`
 * no hay link) y «Cree su cuenta» (`/registro?email=`). Sin URL del Shop no hay ninguno de los dos.
 */
export function enlacesInvitado(
  tenant: { id: string; shopUrl?: string; shopInternalUrl?: string; shopDestinosExtra?: unknown },
  pedido: PedidoRow,
  aviso: AvisoPedido,
  email: string,
): { pagarUrl: string | null; cuentaUrl: string | null } {
  const base = urlPublicaShopParaPedido(tenant, pedido.sitioOrigen, process.env)
  if (!base) return { pagarUrl: null, cuentaUrl: null }
  const cuentaUrl = `${base}/registro?email=${encodeURIComponent(email)}`
  const cobrable =
    aviso !== "pago_recibido" &&
    aviso !== "cancelado" &&
    pedido.estado !== "cancelado" &&
    (pedido.pagoEstado === "pendiente" || pedido.pagoEstado === "fallido") &&
    PAGO_METODOS_EN_LINEA.includes(pedido.pagoMetodo)
  const token = cobrable
    ? tokenLinkPago({
        orderId: pedido.id,
        tenant: tenant.id,
        creadoEn: pedido.createdAt.getTime(),
        reservaVenceEn: pedido.reservaVenceEn ? pedido.reservaVenceEn.getTime() : null,
      })
    : null
  return { pagarUrl: token ? `${base}/pagar/${token}` : null, cuentaUrl }
}

export async function avisarClientePedido(input: {
  tenantId: string
  pedido: PedidoRow
  aviso: AvisoPedido
  now: Date
}): Promise<AvisoResult> {
  const { tenantId, pedido, aviso, now } = input
  const to = pedido.clienteEmail?.trim() ?? null
  if (!looksLikeEmail(to)) return { status: "skipped", reason: "pedido sin email" }

  try {
    const tenant = await getTenantByIdFromDb(tenantId)
    if (!tenant) return { status: "skipped", reason: "tenant no encontrado" }

    // Marca, logo y remitente del sitio donde se compró (sin sitio propio: los del tenant).
    const marca = marcaParaSitio(tenant, pedido.sitioOrigen)
    const { subject, html, text } = buildPedidoEstadoEmail({
      tenantName: marca.name,
      logoUrl: marca.logoUrl,
      numero: formatearNumeroPedido(pedido.numero),
      contactoNombre: pedido.contactoNombre,
      aviso,
      entregaTipo: pedido.entregaTipo,
      pedidosUrl: pedidosUrl(tenant, pedido.sitioOrigen),
      ...(esPedidoDeInvitado(pedido) ? { invitado: enlacesInvitado(tenant, pedido, aviso, to) } : {}),
    })
    const enviado = await sendEmail({ ...tenant, name: marca.name, resendFrom: marca.resendFrom }, to, subject, html, text, {
      tags: [{ name: "tipo", value: `pedido_${aviso}` }],
      // Un reintento del mismo cambio (misma marca de tiempo) no duplica el mail.
      idempotencyKey: `pedido-aviso/${pedido.id}/${aviso}/${now.getTime()}`,
    })
    return enviado ? { status: "sent" } : { status: "skipped", reason: "dry-run" }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) }
  }
}

/** Cambio de estado: sólo avances y cancelación (ver `seAvisaTransicion`). */
export async function avisarCambioEstadoPedido(input: {
  tenantId: string
  pedido: PedidoRow
  desde: EstadoPedido
  hacia: EstadoPedido
  now: Date
}): Promise<AvisoResult> {
  const { desde, hacia } = input
  if (hacia === "pendiente" || !seAvisaTransicion(desde, hacia)) return { status: "skipped", reason: "transición sin aviso" }
  return avisarClientePedido({ tenantId: input.tenantId, pedido: input.pedido, aviso: hacia, now: input.now })
}

/** Log del resultado, sin datos del cliente. */
export function logAviso(evento: string, ctx: { tenant: string; orderId: string }, r: AvisoResult): void {
  if (r.status === "failed") console.error("[admin/pedidos] no se pudo avisar al cliente", { ...ctx, evento, error: r.error })
  else console.info(JSON.stringify({ event: "shop_order_aviso", evento, ...ctx, ...r }))
}
