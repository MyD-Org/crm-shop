// Mail "Su factura" al cliente del Shop cuando un operador vincula la factura de Alegra a su
// pedido. Para el cliente común de la tienda (sin cuenta corriente) es la única vía para
// recibirla: Mi cuenta no le muestra facturas.
//
// Módulo PURO (sin db, env ni red): arma el mail y valida el PDF ya descargado. La descarga y
// el envío los hace `enviarFacturaPedido` (pedido-factura-aviso.ts), después de persistir.

import { oneLine, pedidoEmailHtml, saludoPedido } from "@/lib/pedido-estado-email"

export interface PedidoFacturaEmailInput {
  tenantName: string
  /** "PED-00000123". */
  numeroPedido: string
  /** Número de la factura en Alegra ("00201-00007040"). null = Alegra no lo informó. */
  numeroFactura: string | null
  contactoNombre: string
  /** Link absoluto a "Mis pedidos" del Shop. Sin link, el mail no lleva botón. */
  pedidosUrl?: string | null
}

export function buildPedidoFacturaEmail(input: PedidoFacturaEmailInput): { subject: string; html: string; text: string } {
  const factura = input.numeroFactura ? oneLine(input.numeroFactura) : null
  const saludo = saludoPedido(input.contactoNombre)
  const titulo = "Su factura"
  const cuerpo = "Adjuntamos la factura de su pedido."
  const pie = factura ? `Factura ${factura} · Pedido ${input.numeroPedido}` : `Pedido ${input.numeroPedido}`

  const subject = `${oneLine(input.tenantName)} — ${factura ? `Factura ${factura}` : "Factura"} de su pedido ${input.numeroPedido}`.slice(
    0,
    200,
  )

  const html = pedidoEmailHtml({
    tenantName: input.tenantName,
    titulo,
    parrafos: [saludo, cuerpo],
    pie,
    pedidosUrl: input.pedidosUrl,
  })

  const text = [
    titulo,
    "",
    saludo,
    cuerpo,
    "",
    pie,
    ...(input.pedidosUrl ? ["", `Ver mis pedidos: ${input.pedidosUrl}`] : []),
  ].join("\n")

  return { subject, html, text }
}

/** `Factura-00201-00007040.pdf`. Sólo letras, dígitos, punto y guion; sin número → el id de Alegra. */
export function nombreAdjuntoFactura(numeroFactura: string | null, alegraId: string): string {
  const limpio = (s: string) =>
    s
      .replace(/[^\w.-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60)
  const base = limpio(numeroFactura ?? "") || limpio(alegraId) || "factura"
  return `Factura-${base}.pdf`
}

/** Un PDF de verdad empieza con `%PDF-`. El CDN de Alegra no siempre manda un content-type confiable. */
export function esPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}
