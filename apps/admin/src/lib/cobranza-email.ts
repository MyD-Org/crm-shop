// Mail del Gestor de Cobranza (notifications.ts): recordatorio de vencimiento o de facturas
// vencidas, agrupando todas las facturas pendientes de un cliente en un solo mail.
//
// Módulo PURO (sin db ni env): arma el mail. El recorrido de facturas, la deduplicación y el
// envío quedan en notifications.ts.

import { emailCardHtml, emailDocumentHtml, escapeHtml, oneLine, saludo } from "@/lib/email-layout"

export interface CobranzaItem {
  facturaId: string
  /** "dd/mm/yyyy", tal cual la informa Alegra. */
  vencimiento: string
  saldo: number
  /** negativo = faltan días, 0 = vence hoy, positivo = días de mora. */
  diasDiff: number
}

export interface CobranzaEmailInput {
  tenantName: string
  /** URL del logo del tenant, ya validada con `safeLogoUrl`. Sin esto, la cabecera va en texto. */
  logoUrl?: string | null
  clienteNombre: string
  items: CobranzaItem[]
}

function fmtMonto(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n)
}

function estadoDe(diasDiff: number): string {
  if (diasDiff > 0) return `vencida hace ${diasDiff} día${diasDiff === 1 ? "" : "s"}`
  if (diasDiff === 0) return "vence hoy"
  return `vence en ${-diasDiff} día${diasDiff === -1 ? "" : "s"}`
}

export function buildCobranzaEmail(input: CobranzaEmailInput): { subject: string; html: string; text: string } {
  const { items, tenantName, clienteNombre } = input
  const e = escapeHtml
  const vencidas = items.filter((i) => i.diasDiff > 0)
  const total = items.reduce((acc, i) => acc + i.saldo, 0)
  const saludoTexto = saludo(clienteNombre)
  const intro = vencidas.length
    ? "Le recordamos que tiene facturas con saldo vencido:"
    : "Le recordamos los próximos vencimientos de su cuenta corriente:"

  const subject = vencidas.length
    ? `${oneLine(tenantName)} — Tiene ${vencidas.length === 1 ? "una factura vencida" : `${vencidas.length} facturas vencidas`}`
    : `${oneLine(tenantName)} — Recordatorio de vencimiento`

  const filas = items
    .map((i) => {
      const estado = estadoDe(i.diasDiff)
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${e(i.facturaId)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${e(i.vencimiento)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${e(fmtMonto(i.saldo))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${i.diasDiff > 0 ? "#b91c1c" : "#92400e"}">${e(estado)}</td>
      </tr>`
    })
    .join("")

  const contenidoHtml = `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px">
          <thead><tr style="text-align:left;color:#6b7280">
            <th style="padding:8px 12px">Factura</th><th style="padding:8px 12px">Vencimiento</th>
            <th style="padding:8px 12px;text-align:right">Saldo</th><th style="padding:8px 12px">Estado</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
        <p style="margin:16px 0 0;font-weight:600">Total: ${e(fmtMonto(total))}</p>
        <p style="margin:12px 0 0">Puede ver el detalle y descargar sus facturas desde el portal de clientes.</p>`

  const pie = "Si ya realizó el pago, desestime este mensaje. Ante cualquier duda, comuníquese con atención al cliente."

  const html = emailDocumentHtml(
    emailCardHtml({
      tenantName,
      logoUrl: input.logoUrl,
      preheader: intro,
      titulo: vencidas.length ? "Tiene facturas vencidas" : "Recordatorio de vencimiento",
      parrafos: [saludoTexto, intro],
      contenidoHtml,
      pie,
    }),
    subject,
  )

  const filasTxt = items.map((i) => `${i.facturaId} — vence ${i.vencimiento} — ${fmtMonto(i.saldo)} — ${estadoDe(i.diasDiff)}`)

  const text = [
    tenantName,
    "",
    saludoTexto,
    intro,
    "",
    ...filasTxt,
    "",
    `Total: ${fmtMonto(total)}`,
    "",
    "Puede ver el detalle y descargar sus facturas desde el portal de clientes.",
    "",
    pie,
  ].join("\n")

  return { subject, html, text }
}
