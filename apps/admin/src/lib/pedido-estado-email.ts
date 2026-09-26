// Mail al cliente del Shop cuando un operador cambia el estado de su pedido o registra su pago.
//
// Módulo PURO (sin db ni env): decide si una transición se avisa y arma el mail. El envío lo
// hace `avisarClientePedido` (pedido-estado-aviso.ts), después de persistir el cambio.
//
// Sólo se avisa el avance del pedido y la cancelación. Las "correcciones" hacia atrás
// (ej. en_camino → preparacion) son errores del operador que se deshacen: mandar
// "Su pedido está en preparación" después de "Su pedido está en camino" confunde al cliente.

import { emailCardHtml, emailDocumentHtml, oneLine, saludo } from "@/lib/email-layout"
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
  /** URL del logo del tenant, ya validada con `safeLogoUrl`. Sin esto, la cabecera va en texto. */
  logoUrl?: string | null
  /** "PED-00000123". */
  numero: string
  contactoNombre: string
  aviso: AvisoPedido
  entregaTipo: string
  /** Link absoluto a "Mis pedidos" del Shop. Sin link, el mail no lleva botón. */
  pedidosUrl?: string | null
}

/** "Hola, Ana:" o "Hola:" si el pedido no tiene nombre. Envuelve `saludo` de email-layout.ts. */
export function saludoPedido(contactoNombre: string): string {
  return saludo(contactoNombre)
}

export function buildPedidoEstadoEmail(input: PedidoEstadoEmailInput): { subject: string; html: string; text: string } {
  const copy = COPY[input.aviso]
  const retiro = input.entregaTipo === "retiro"
  const cuerpo = copy.cuerpo(retiro)
  const saludoTexto = saludoPedido(input.contactoNombre)
  const pie = `Pedido ${input.numero}`

  const subject = `${oneLine(input.tenantName)} — Pedido ${input.numero} ${copy.asunto}`.slice(0, 200)

  const html = emailDocumentHtml(
    emailCardHtml({
      tenantName: input.tenantName,
      logoUrl: input.logoUrl,
      preheader: cuerpo,
      titulo: copy.titulo,
      parrafos: [saludoTexto, cuerpo],
      pie,
      boton: input.pedidosUrl ? { url: input.pedidosUrl, texto: "Ver mis pedidos" } : null,
    }),
    copy.titulo,
  )

  const text = [
    copy.titulo,
    "",
    saludoTexto,
    cuerpo,
    "",
    pie,
    ...(input.pedidosUrl ? ["", `Ver mis pedidos: ${input.pedidosUrl}`] : []),
  ].join("\n")

  return { subject, html, text }
}
