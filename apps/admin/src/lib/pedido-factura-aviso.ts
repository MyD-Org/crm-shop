// Envío de la factura vinculada al cliente del Shop, con el PDF adjunto. Se llama DESPUÉS de
// persistir el vínculo y NUNCA tira: si el mail no sale, la factura igual quedó vinculada y el
// operador puede reenviarla desde el detalle del pedido.
//
// La URL del PDF que da Alegra está firmada y vence: se baja acá, en el servidor, y va como
// adjunto. Nunca se guarda ni viaja en el mail. Sin PDF (Alegra no lo da, la descarga falla o
// supera el límite) NO se manda nada: un "Su factura" sin la factura no le sirve al cliente.

import { getDocumentPdf } from "@/lib/alegra"
import { maskEmail, sendEmail } from "@/lib/email"
import { looksLikeEmail, pedidosUrl } from "@/lib/pedido-estado-aviso"
import { buildPedidoFacturaEmail, esPdf, nombreAdjuntoFactura } from "@/lib/pedido-factura-email"
import { formatearNumeroPedido, type PedidoRow } from "@/lib/pedidos-repo"
import { ATTACH_MAX_BYTES } from "@/lib/receipt-email"
import { getTenantByIdFromDb } from "@/lib/tenants"

/** Lo que ve el operador. `destino` va enmascarado (`c***@cliente.example`). */
export type AvisoFacturaResultado = "enviado" | "sin_email" | "sin_pdf" | "fallo"

export interface AvisoFactura {
  resultado: AvisoFacturaResultado
  destino: string | null
  /** Detalle para el log, sin datos del cliente. */
  motivo?: string
}

const DESCARGA_TIMEOUT_MS = 20_000

type Descarga = { ok: true; pdf: Buffer } | { ok: false; motivo: string }

/** Baja el PDF con timeout y tope de tamaño (corta la lectura al pasarse). */
async function descargarPdf(url: string): Promise<Descarga> {
  let res: Response
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(DESCARGA_TIMEOUT_MS) })
  } catch (err) {
    return { ok: false, motivo: `descarga: ${err instanceof Error ? err.name : "error"}` }
  }
  if (!res.ok || !res.body) return { ok: false, motivo: `descarga: HTTP ${res.status}` }
  const declarado = Number(res.headers.get("content-length"))
  if (Number.isFinite(declarado) && declarado > ATTACH_MAX_BYTES) {
    await res.body.cancel().catch(() => {})
    return { ok: false, motivo: "descarga: supera el límite" }
  }

  const partes: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > ATTACH_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return { ok: false, motivo: "descarga: supera el límite" }
      }
      partes.push(value)
    }
  } catch (err) {
    return { ok: false, motivo: `descarga: ${err instanceof Error ? err.name : "error"}` }
  }
  const pdf = Buffer.concat(partes)
  if (!esPdf(pdf)) return { ok: false, motivo: "descarga: no es un PDF" }
  return { ok: true, pdf }
}

/**
 * Manda la factura vinculada al pedido. `reenvio` = el operador pidió reenviarla: lleva otra
 * clave de idempotencia (la del vínculo deduplica el mismo envío, no un reenvío pedido a mano).
 */
export async function enviarFacturaPedido(input: {
  tenantId: string
  pedido: PedidoRow
  reenvio?: Date
}): Promise<AvisoFactura> {
  const { tenantId, pedido, reenvio } = input
  const to = pedido.clienteEmail?.trim() ?? null
  if (!looksLikeEmail(to)) return { resultado: "sin_email", destino: null }
  const destino = maskEmail(to)
  const alegraId = pedido.facturaAlegraId
  if (!alegraId) return { resultado: "sin_pdf", destino, motivo: "pedido sin factura" }

  try {
    const tenant = await getTenantByIdFromDb(tenantId)
    if (!tenant) return { resultado: "fallo", destino, motivo: "tenant no encontrado" }
    if (tenant.alegraMock) return { resultado: "sin_pdf", destino, motivo: "alegra mock" }

    const doc = await getDocumentPdf(tenant, "factura", alegraId)
    if (!doc?.pdfUrl) return { resultado: "sin_pdf", destino, motivo: doc ? "factura sin PDF" : "factura no encontrada" }
    const descarga = await descargarPdf(doc.pdfUrl)
    if (!descarga.ok) return { resultado: "sin_pdf", destino, motivo: descarga.motivo }

    const numeroFactura = pedido.facturaNumero ?? doc.number
    const { subject, html, text } = buildPedidoFacturaEmail({
      tenantName: tenant.name,
      numeroPedido: formatearNumeroPedido(pedido.numero),
      numeroFactura,
      contactoNombre: pedido.contactoNombre,
      pedidosUrl: pedidosUrl(),
    })
    const base = `pedido-factura/${pedido.id}/${alegraId}`
    const enviado = await sendEmail(tenant, to, subject, html, text, {
      attachments: [
        { filename: nombreAdjuntoFactura(numeroFactura, alegraId), content: descarga.pdf, contentType: "application/pdf" },
      ],
      tags: [{ name: "tipo", value: "pedido_factura" }],
      // Un reintento del mismo vínculo no duplica el mail; un reenvío pedido a mano sí sale.
      idempotencyKey: reenvio ? `${base}/reenvio/${reenvio.getTime()}` : base,
    })
    return enviado ? { resultado: "enviado", destino } : { resultado: "fallo", destino, motivo: "dry-run" }
  } catch (err) {
    return { resultado: "fallo", destino, motivo: err instanceof Error ? err.message : String(err) }
  }
}

/** Log del resultado, sin datos del cliente (ni el destino enmascarado). */
export function logAvisoFactura(ctx: { tenant: string; orderId: string }, r: AvisoFactura): void {
  const evento = { event: "shop_order_factura_mail", ...ctx, resultado: r.resultado, ...(r.motivo ? { motivo: r.motivo } : {}) }
  if (r.resultado === "fallo" || r.resultado === "sin_pdf") console.error("[admin/pedidos/factura] no se envió la factura", evento)
  else console.info(JSON.stringify(evento))
}
