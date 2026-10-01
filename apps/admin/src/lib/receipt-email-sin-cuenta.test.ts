import { describe, it, expect } from "vitest"
import { buildReceiptEmail, type ReceiptEmailInput } from "@/lib/receipt-email"

// Mail de aviso de un comprobante informado por un comprador SIN cuenta corriente
// (codigocliente NULL desde la migración 0056). Datos inventados.

function input(receipt: Partial<ReceiptEmailInput["receipt"]> = {}): ReceiptEmailInput {
  return {
    tenantName: "Empresa Demo",
    receipt: {
      id: "3f6f8d6e-2f6b-4a1c-9e5d-7b2c4a6d8e0f",
      razonsocial: "Comprador Demo",
      cuit: "",
      codigocliente: "123",
      amount: "150000.50",
      paidOn: "2026-09-01",
      method: "transferencia",
      notes: null,
      fileMime: "application/pdf",
      fileSize: 3 * 1024 * 1024,
      submittedAt: new Date("2026-09-12T15:00:00.000Z"),
      ...receipt,
    },
    adminUrl: "https://tenant-a.example.com/admin/comprobantes?id=3f6f8d6e-2f6b-4a1c-9e5d-7b2c4a6d8e0f",
    attachmentIncluded: true,
  }
}

describe("buildReceiptEmail: comprador sin cuenta corriente (codigocliente null)", () => {
  it("indica 'Sin cuenta corriente · Pedido …' en lugar del código, en html y texto", () => {
    const { html, text } = buildReceiptEmail(input({ codigocliente: null, pedidoNumero: "PED-00000042" }))
    expect(html).toContain("Sin cuenta corriente · Pedido PED-00000042")
    expect(html).not.toContain(">Código<")
    expect(text).toContain("Cuenta: Sin cuenta corriente · Pedido PED-00000042")
    expect(text).not.toContain("Código:")
    expect(html).not.toContain("null")
    expect(text).not.toContain("null")
  })

  it("sin número de pedido conocido igual dice 'Sin cuenta corriente'", () => {
    const { text } = buildReceiptEmail(input({ codigocliente: null }))
    expect(text).toContain("Cuenta: Sin cuenta corriente")
    expect(text).not.toContain("Pedido")
  })

  it("el número de pedido se escapa", () => {
    const { html } = buildReceiptEmail(input({ codigocliente: null, pedidoNumero: "<b>PED</b>" }))
    expect(html).not.toContain("<b>PED</b>")
    expect(html).toContain("&lt;b&gt;PED&lt;/b&gt;")
  })

  it("un comprobante vinculado con pedido conserva el código y suma el pedido", () => {
    const { html, text } = buildReceiptEmail(input({ pedidoNumero: "PED-00000007" }))
    expect(text).toContain("Código: 123")
    expect(text).toContain("Pedido: PED-00000007")
    expect(html).toContain("PED-00000007")
  })

  it("un comprobante clásico (sin pedido) queda igual que antes", () => {
    const { text } = buildReceiptEmail(input())
    expect(text).toContain("Código: 123")
    expect(text).not.toContain("Pedido")
  })
})
