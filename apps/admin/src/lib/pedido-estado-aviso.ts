// Envío del mail al cliente del Shop cuando cambia su pedido (estado o pago). Se llama DESPUÉS
// de persistir el cambio y NUNCA tira: si el mail no sale, el cambio ya quedó y el cliente igual
// lo ve en "Mis pedidos". El resultado sólo se loguea.

import { sendEmail } from "@/lib/email"
import { buildPedidoEstadoEmail, seAvisaTransicion, type AvisoPedido } from "@/lib/pedido-estado-email"
import { formatearNumeroPedido, type PedidoRow } from "@/lib/pedidos-repo"
import type { EstadoPedido } from "@/lib/pedidos-transiciones"
import { getTenantByIdFromDb } from "@/lib/tenants"

export type AvisoResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }

const PATH_PEDIDOS = "/mi-cuenta/pedidos"

function looksLikeEmail(s: string | null): s is string {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

function pedidosUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SHOP_URL?.trim()
  return base ? `${base.replace(/\/+$/, "")}${PATH_PEDIDOS}` : null
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

    const { subject, html, text } = buildPedidoEstadoEmail({
      tenantName: tenant.name,
      numero: formatearNumeroPedido(pedido.numero),
      contactoNombre: pedido.contactoNombre,
      aviso,
      entregaTipo: pedido.entregaTipo,
      pedidosUrl: pedidosUrl(),
    })
    const enviado = await sendEmail(tenant, to, subject, html, text, {
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
