import { describe, expect, it } from "vitest"
import { buildPedidoEstadoEmail } from "@/lib/pedido-estado-email"
import { buildPedidoFacturaEmail } from "@/lib/pedido-factura-email"

const base = {
  tenantName: "Tienda B",
  numero: "PED-00000007",
  contactoNombre: "Ana",
  aviso: "confirmado" as const,
  entregaTipo: "retiro",
  pedidosUrl: "https://b.example/mi-cuenta/pedidos",
}
const CUENTA = "https://b.example/registro?email=a%40b.example"

describe("buildPedidoEstadoEmail: invitado", () => {
  it("sin `invitado`: «Ver mis pedidos», como siempre", () => {
    const { html, text } = buildPedidoEstadoEmail(base)
    expect(html).toContain("Ver mis pedidos")
    expect(text).toContain("Ver mis pedidos: https://b.example/mi-cuenta/pedidos")
    expect(html).not.toContain("Cree su cuenta")
  })

  it("con `invitado` ignora pedidosUrl", () => {
    const { html, text } = buildPedidoEstadoEmail({ ...base, invitado: { pagarUrl: "https://b.example/pagar/x", cuentaUrl: CUENTA } })
    expect(html).not.toContain("Ver mis pedidos")
    expect(html).not.toContain("/mi-cuenta/pedidos")
    expect(html).toContain('href="https://b.example/pagar/x"')
    expect(html).toContain(CUENTA)
    expect(text).toContain("Pagar su pedido: https://b.example/pagar/x")
    expect(text).toContain(`Cree su cuenta: ${CUENTA}`)
  })

  it("sin link de pago: «Cree su cuenta» pasa a ser el botón (una sola vez)", () => {
    const { html } = buildPedidoEstadoEmail({ ...base, invitado: { pagarUrl: null, cuentaUrl: CUENTA } })
    expect(html).not.toContain("Pagar su pedido")
    // El enlace aparece una sola vez (la otra mención es la frase explicativa).
    expect(html.match(/>Cree su cuenta</g)).toHaveLength(1)
  })

  it("sin ningún link: sin botón", () => {
    const { html } = buildPedidoEstadoEmail({ ...base, invitado: { pagarUrl: null, cuentaUrl: null } })
    expect(html).not.toContain("Ver mis pedidos")
    expect(html).not.toContain("Cree su cuenta")
  })
})

describe("buildPedidoFacturaEmail: invitado", () => {
  const f = { tenantName: "Tienda B", numeroPedido: "PED-00000007", numeroFactura: "0001-00000001", contactoNombre: "Ana" }

  it("con cuenta: «Ver mis pedidos»", () => {
    expect(buildPedidoFacturaEmail({ ...f, pedidosUrl: "https://b.example/mi-cuenta/pedidos" }).html).toContain("Ver mis pedidos")
  })

  it("invitado: «Cree su cuenta» y nada de Mi cuenta", () => {
    const { html, text } = buildPedidoFacturaEmail({ ...f, cuentaUrl: CUENTA })
    expect(html).toContain("Cree su cuenta")
    expect(html).not.toContain("Ver mis pedidos")
    expect(text).toContain(`Cree su cuenta: ${CUENTA}`)
  })
})
