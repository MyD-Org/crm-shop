import { describe, expect, it } from "vitest"
import { buildPedidoFacturaEmail, esPdf, nombreAdjuntoFactura } from "@/lib/pedido-factura-email"

describe("buildPedidoFacturaEmail", () => {
  const base = {
    tenantName: "Tienda <Demo>",
    numeroPedido: "PED-00000123",
    numeroFactura: "00201-00007040",
    contactoNombre: "Ana <b>",
  }

  it("asunto con factura y pedido; cuerpo con escape de HTML y botón", () => {
    const m = buildPedidoFacturaEmail({ ...base, pedidosUrl: "https://tienda.cliente.example/mi-cuenta/pedidos" })
    expect(m.subject).toBe("Tienda <Demo> — Factura 00201-00007040 de su pedido PED-00000123")
    expect(m.html).toContain("Tienda &lt;Demo&gt;")
    expect(m.html).toContain("Hola, Ana &lt;b&gt;:")
    expect(m.html).toContain("Adjuntamos la factura de su pedido.")
    expect(m.html).toContain("Factura 00201-00007040 · Pedido PED-00000123")
    expect(m.html).toContain('href="https://tienda.cliente.example/mi-cuenta/pedidos"')
    expect(m.html).toContain("Ver mis pedidos")
    expect(m.text).toContain("Ver mis pedidos: https://tienda.cliente.example/mi-cuenta/pedidos")
    expect(m.text).not.toContain("<p")
  })

  it("sin link no hay botón; sin nombre saluda genérico; sin número de factura", () => {
    const m = buildPedidoFacturaEmail({ ...base, contactoNombre: "  ", numeroFactura: null })
    expect(m.subject).toBe("Tienda <Demo> — Factura de su pedido PED-00000123")
    expect(m.html).not.toContain("Ver mis pedidos")
    expect(m.text).toContain("Hola:")
    expect(m.text).toContain("Pedido PED-00000123")
  })

  it("CR/LF del tenant o del número no llegan al asunto", () => {
    const m = buildPedidoFacturaEmail({ ...base, tenantName: "Tienda\r\nBcc: x@cliente.example", numeroFactura: "1\n2" })
    expect(m.subject).not.toMatch(/[\r\n]/)
  })
})

describe("nombreAdjuntoFactura", () => {
  it("sanea el número y cae al id de Alegra", () => {
    expect(nombreAdjuntoFactura("00201-00007040", "7040")).toBe("Factura-00201-00007040.pdf")
    expect(nombreAdjuntoFactura("A 0001/ 23\"x", "7040")).toBe("Factura-A-0001-23-x.pdf")
    expect(nombreAdjuntoFactura("../..", "7040")).toBe("Factura-7040.pdf")
    expect(nombreAdjuntoFactura(null, "7040")).toBe("Factura-7040.pdf")
  })
})

describe("esPdf", () => {
  it("mira los bytes mágicos", () => {
    expect(esPdf(new TextEncoder().encode("%PDF-1.7 ..."))).toBe(true)
    expect(esPdf(new TextEncoder().encode("<html>"))).toBe(false)
    expect(esPdf(new Uint8Array())).toBe(false)
  })
})
