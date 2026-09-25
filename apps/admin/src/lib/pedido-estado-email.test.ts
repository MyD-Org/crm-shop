import { describe, expect, it } from "vitest"
import { buildPedidoEstadoEmail, seAvisaTransicion } from "@/lib/pedido-estado-email"
import { TRANSICIONES, type EstadoPedido } from "@/lib/pedidos-transiciones"

describe("seAvisaTransicion", () => {
  it("avisa los avances y la cancelación, no las correcciones hacia atrás", () => {
    const avisadas: string[] = []
    for (const [desde, hacias] of Object.entries(TRANSICIONES) as [EstadoPedido, readonly EstadoPedido[]][]) {
      for (const hacia of hacias) if (seAvisaTransicion(desde, hacia)) avisadas.push(`${desde}>${hacia}`)
    }
    expect(avisadas.sort()).toEqual(
      [
        "pendiente>confirmado",
        "pendiente>cancelado",
        "confirmado>preparacion",
        "confirmado>entregado",
        "confirmado>cancelado",
        "preparacion>en_camino",
        "preparacion>entregado",
        "preparacion>cancelado",
        "en_camino>entregado",
        "en_camino>cancelado",
      ].sort(),
    )
  })
})

describe("buildPedidoEstadoEmail", () => {
  const base = {
    tenantName: "Tienda <Demo>",
    numero: "PED-00000042",
    contactoNombre: "Ana <b>",
    entregaTipo: "envio",
  }

  it("arma asunto, saludo y botón con escape de HTML", () => {
    const m = buildPedidoEstadoEmail({ ...base, aviso: "en_camino", pedidosUrl: "https://tienda.cliente.example/mi-cuenta/pedidos" })
    expect(m.subject).toBe("Tienda <Demo> — Pedido PED-00000042 en camino")
    expect(m.html).toContain("Tienda &lt;Demo&gt;")
    expect(m.html).toContain("Hola, Ana &lt;b&gt;:")
    expect(m.html).not.toContain("<b>:")
    expect(m.html).toContain('href="https://tienda.cliente.example/mi-cuenta/pedidos"')
    expect(m.text).toContain("Ver mis pedidos: https://tienda.cliente.example/mi-cuenta/pedidos")
  })

  it("sin URL del Shop no lleva botón", () => {
    const m = buildPedidoEstadoEmail({ ...base, aviso: "confirmado" })
    expect(m.html).not.toContain("Ver mis pedidos")
    expect(m.text).not.toContain("Ver mis pedidos")
  })

  it("adapta el texto al retiro en el local", () => {
    const m = buildPedidoEstadoEmail({ ...base, aviso: "entregado", entregaTipo: "retiro" })
    expect(m.text).toContain("Su pedido fue retirado.")
  })

  it("no expone el motivo de cancelación (dato interno)", () => {
    const m = buildPedidoEstadoEmail({ ...base, aviso: "cancelado" })
    expect(m.subject).toContain("cancelado")
    expect(m.text).toContain("Su pedido fue cancelado.")
  })

  it("avisa el pago registrado", () => {
    const m = buildPedidoEstadoEmail({ ...base, aviso: "pago_recibido" })
    expect(m.subject).toBe("Tienda <Demo> — Pedido PED-00000042 pago recibido")
    expect(m.text).toContain("Recibimos su pago")
  })

  it("saca saltos de línea del asunto", () => {
    const m = buildPedidoEstadoEmail({ ...base, tenantName: "Tienda\r\nBcc: x@cliente.example", aviso: "confirmado" })
    expect(m.subject).not.toMatch(/[\r\n]/)
  })
})
