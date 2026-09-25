// Mail al cliente del Shop cuando un operador cambia el estado de su pedido o registra su pago.
//
// Módulo PURO (sin db ni env): decide si una transición se avisa y arma el mail. El envío lo
// hace `avisarClientePedido` (pedido-estado-aviso.ts), después de persistir el cambio.
//
// Sólo se avisa el avance del pedido y la cancelación. Las "correcciones" hacia atrás
// (ej. en_camino → preparacion) son errores del operador que se deshacen: mandar
// "Su pedido está en preparación" después de "Su pedido está en camino" confunde al cliente.

import { escapeHtml } from "@/lib/receipt-email"
import type { EstadoPedido } from "@/lib/pedidos-transiciones"

/** Orden del camino feliz. `cancelado` queda afuera: se avisa siempre. */
const ORDEN: Record<Exclude<EstadoPedido, "cancelado">, number> = {
  pendiente: 0,
  confirmado: 1,
  preparacion: 2,
  en_camino: 3,
  entregado: 4,
}

export function seAvisaTransicion(desde: EstadoPedido, hacia: EstadoPedido): boolean {
  if (hacia === "cancelado") return desde !== "cancelado"
  if (desde === "cancelado") return false
  return ORDEN[hacia] > ORDEN[desde]
}

type EstadoAvisable = Exclude<EstadoPedido, "pendiente">
/** Lo que se le avisa al cliente: un estado nuevo del pedido o el pago registrado. */
export type AvisoPedido = EstadoAvisable | "pago_recibido"

const COPY: Record<AvisoPedido, { asunto: string; titulo: string; cuerpo: (retiro: boolean) => string }> = {
  confirmado: {
    asunto: "confirmado",
    titulo: "Su pedido fue confirmado",
    cuerpo: () => "Recibimos su pedido y lo confirmamos. Le avisaremos cuando empecemos a prepararlo.",
  },
  preparacion: {
    asunto: "en preparación",
    titulo: "Estamos preparando su pedido",
    cuerpo: (retiro) =>
      retiro
        ? "Su pedido está en preparación. Le avisaremos cuando esté listo."
        : "Su pedido está en preparación. Le avisaremos cuando salga para su domicilio.",
  },
  en_camino: {
    asunto: "en camino",
    titulo: "Su pedido está en camino",
    cuerpo: () => "Su pedido ya salió y está en camino a la dirección de entrega.",
  },
  entregado: {
    asunto: "entregado",
    titulo: "Su pedido fue entregado",
    cuerpo: (retiro) =>
      retiro ? "Su pedido fue retirado. ¡Gracias por su compra!" : "Su pedido fue entregado. ¡Gracias por su compra!",
  },
  pago_recibido: {
    asunto: "pago recibido",
    titulo: "Recibimos su pago",
    cuerpo: () => "Registramos el pago de su pedido. Le avisaremos cuando avance.",
  },
  cancelado: {
    asunto: "cancelado",
    titulo: "Su pedido fue cancelado",
    cuerpo: () => "Su pedido fue cancelado. Si tiene alguna consulta, comuníquese con nosotros.",
  },
}

export interface PedidoEstadoEmailInput {
  tenantName: string
  /** "PED-00000123". */
  numero: string
  contactoNombre: string
  aviso: AvisoPedido
  entregaTipo: string
  /** Link absoluto a "Mis pedidos" del Shop. Sin link, el mail no lleva botón. */
  pedidosUrl?: string | null
}

/** CR/LF y controles ⇒ espacio (el nombre del tenant va al subject). */
function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
}

export function buildPedidoEstadoEmail(input: PedidoEstadoEmailInput): { subject: string; html: string; text: string } {
  const e = escapeHtml
  const copy = COPY[input.aviso]
  const retiro = input.entregaTipo === "retiro"
  const cuerpo = copy.cuerpo(retiro)
  const nombre = input.contactoNombre.trim()
  const saludo = nombre ? `Hola, ${nombre}:` : "Hola:"

  const subject = `${oneLine(input.tenantName)} — Pedido ${input.numero} ${copy.asunto}`.slice(0, 200)

  const boton = input.pedidosUrl
    ? `<p style="margin:24px 0 0"><a href="${e(input.pedidosUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Ver mis pedidos</a></p>`
    : ""

  const html = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef1f5;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;border-top:3px solid #1f8cff">
      <tr><td style="padding:28px 32px 0">
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280">${e(input.tenantName)}</div>
      </td></tr>
      <tr><td style="padding:20px 32px 28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#111827">
        <p style="margin:0 0 16px;font-size:18px;font-weight:700">${e(copy.titulo)}</p>
        <p style="margin:0 0 12px">${e(saludo)}</p>
        <p style="margin:0 0 12px">${e(cuerpo)}</p>
        <p style="margin:0;color:#6b7280;font-size:14px">Pedido ${e(input.numero)}</p>${boton}
      </td></tr>
    </table>
  </td></tr>
</table>`

  const text = [
    copy.titulo,
    "",
    saludo,
    cuerpo,
    "",
    `Pedido ${input.numero}`,
    ...(input.pedidosUrl ? ["", `Ver mis pedidos: ${input.pedidosUrl}`] : []),
  ].join("\n")

  return { subject, html, text }
}
