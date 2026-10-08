import { describe, it, expect } from "vitest"
import { toAdminDto, type PaymentReceiptRow } from "@/lib/payment-receipts"

// toAdminDto es puro: acá se prueba cómo serializa un comprobante de un comprador sin cuenta
// corriente (codigocliente NULL desde la migración 0056). Datos inventados.

const NOW = new Date("2026-10-01T15:00:00.000Z")

function fila(over: Partial<PaymentReceiptRow> = {}): PaymentReceiptRow {
  return {
    id: "3f6f8d6e-2f6b-4a1c-9e5d-7b2c4a6d8e0f",
    tenantId: "tenant-a",
    codigocliente: null,
    shopOrderId: "11111111-2222-4333-8444-555555555555",
    clerkUserId: "user_1",
    razonsocial: "Comprador Demo",
    cuit: "",
    clientEmail: "comprador@cliente.example",
    amount: "1500.00",
    currency: "ARS",
    paidOn: "2026-10-01",
    method: "transferencia",
    methodOther: null,
    notes: null,
    status: "pending",
    processingStartedAt: null,
    rejectReason: null,
    declaredContentType: "application/pdf",
    declaredSize: 1000,
    fileKey: "k",
    fileMime: "application/pdf",
    fileSize: 1000,
    fileOriginalName: null,
    fileSha256: "a".repeat(64),
    convertedFrom: null,
    emailStatus: "sent",
    emailError: null,
    emailSentAt: NOW,
    emailAttempts: 1,
    emailLastAttemptAt: NOW,
    loadedAt: null,
    loadedBy: null,
    loadedByName: null,
    alegraPaymentId: null,
    alegraPaymentNumber: null,
    declaredAmount: null,
    declaredPaidOn: null,
    createdAt: NOW,
    submittedAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

describe("toAdminDto: comprador sin cuenta corriente", () => {
  it("codigocliente null y el pedido asociado (con su número si se conoce)", () => {
    const dto = toAdminDto(fila(), NOW, "PED-00000042")
    expect(dto.codigocliente).toBeNull()
    expect(dto.pedido).toEqual({
      id: "11111111-2222-4333-8444-555555555555",
      numero: "PED-00000042",
      total: null,
      pagado: false,
      cancelado: false,
    })
  })

  it("con los datos del pedido: total, pagado y cancelado (para Registrar pago y Coincide)", () => {
    const dto = toAdminDto(fila(), NOW, null, { numero: "PED-00000042", total: "80985.12", pagado: true, cancelado: false })
    expect(dto.pedido).toEqual({
      id: "11111111-2222-4333-8444-555555555555",
      numero: "PED-00000042",
      total: "80985.12",
      pagado: true,
      cancelado: false,
    })
  })

  it("pedido sin número resoluble: id presente, numero null", () => {
    expect(toAdminDto(fila(), NOW).pedido).toMatchObject({ id: "11111111-2222-4333-8444-555555555555", numero: null })
  })

  it("comprobante clásico: pedido null y codigocliente tal cual", () => {
    const dto = toAdminDto(fila({ codigocliente: "42", shopOrderId: null, clerkUserId: null }), NOW)
    expect(dto.codigocliente).toBe("42")
    expect(dto.pedido).toBeNull()
  })
})
