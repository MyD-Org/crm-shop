import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PedidoRow } from "@/lib/pedidos-repo"

// Flujo de envío de la factura: Alegra, el CDN del PDF, el tenant y Resend simulados.
// Nada sale a la red. Datos inventados.

const getDocumentPdf = vi.fn()
const sendEmail = vi.fn()
const getTenantByIdFromDb = vi.fn()

vi.mock("@/lib/alegra", () => ({ getDocumentPdf: (...a: unknown[]) => getDocumentPdf(...a) }))
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}))
vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: (...a: unknown[]) => getTenantByIdFromDb(...a) }))

const { enviarFacturaPedido } = await import("@/lib/pedido-factura-aviso")

const PDF_URL = "https://cdn.alegra.example/firmada/factura.pdf?token=secreto"
const PDF = new TextEncoder().encode("%PDF-1.4 contenido")

const pedido = (over: Partial<PedidoRow> = {}): PedidoRow =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    numero: 123,
    clienteEmail: "ana@cliente.example",
    contactoNombre: "Ana",
    facturaAlegraId: "7040",
    facturaNumero: "00201-00007040",
    ...over,
  }) as PedidoRow

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  getDocumentPdf.mockReset().mockResolvedValue({ clientAlegraId: "55", pdfUrl: PDF_URL, number: "00201-00007040" })
  sendEmail.mockReset().mockResolvedValue(true)
  getTenantByIdFromDb.mockReset().mockResolvedValue({ id: "tenant-a", name: "Tienda Demo", alegraMock: false })
  fetchMock = vi.fn(async () => new Response(PDF, { status: 200, headers: { "content-type": "application/octet-stream" } }))
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("NEXT_PUBLIC_SHOP_URL", "https://tienda.cliente.example/")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("enviarFacturaPedido", () => {
  it("baja el PDF y lo manda adjunto, con clave de idempotencia por pedido + factura", async () => {
    const r = await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })
    expect(r).toEqual({ resultado: "enviado", destino: "an***@cliente.example" })
    expect(getDocumentPdf).toHaveBeenCalledWith(expect.objectContaining({ id: "tenant-a" }), "factura", "7040")
    expect(fetchMock).toHaveBeenCalledWith(PDF_URL, expect.objectContaining({ cache: "no-store" }))

    const [, to, subject, html, text, opts] = sendEmail.mock.calls[0]
    expect(to).toBe("ana@cliente.example")
    expect(subject).toBe("Tienda Demo — Factura 00201-00007040 de su pedido PED-00000123")
    expect(html).toContain("https://tienda.cliente.example/mi-cuenta/pedidos")
    // La URL firmada nunca viaja en el mail.
    expect(html).not.toContain("alegra.example")
    expect(text).not.toContain("alegra.example")
    expect(opts.idempotencyKey).toBe("pedido-factura/11111111-1111-4111-8111-111111111111/7040")
    expect(opts.attachments).toHaveLength(1)
    expect(opts.attachments[0].filename).toBe("Factura-00201-00007040.pdf")
    expect(opts.attachments[0].contentType).toBe("application/pdf")
    expect(Buffer.from(opts.attachments[0].content).toString()).toBe("%PDF-1.4 contenido")
  })

  it("reenvío: otra clave de idempotencia", async () => {
    const now = new Date("2026-09-25T12:00:00Z")
    await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido(), reenvio: now })
    expect(sendEmail.mock.calls[0][5].idempotencyKey).toBe(
      `pedido-factura/11111111-1111-4111-8111-111111111111/7040/reenvio/${now.getTime()}`,
    )
  })

  it("sin email válido → sin_email, sin tocar Alegra", async () => {
    for (const clienteEmail of [null, "", "no-es-un-mail"]) {
      const r = await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido({ clienteEmail }) })
      expect(r).toEqual({ resultado: "sin_email", destino: null })
    }
    expect(getDocumentPdf).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("Alegra sin PDF o sin la factura → sin_pdf y no se manda nada", async () => {
    getDocumentPdf.mockResolvedValueOnce({ clientAlegraId: "55", pdfUrl: null, number: null })
    expect((await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).resultado).toBe("sin_pdf")
    getDocumentPdf.mockResolvedValueOnce(null)
    expect((await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).resultado).toBe("sin_pdf")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("descarga que falla, que no es PDF o que supera el límite → sin_pdf", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }))
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
    fetchMock.mockResolvedValueOnce(new Response("<html>vencida</html>", { status: 200 }))
    fetchMock.mockResolvedValueOnce(
      new Response(PDF, { status: 200, headers: { "content-length": String(11 * 1024 * 1024) } }),
    )
    for (let i = 0; i < 4; i++) {
      expect((await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).resultado).toBe("sin_pdf")
    }
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("corta la lectura si el cuerpo supera el límite aunque no lo declare", async () => {
    const grande = new Uint8Array(11 * 1024 * 1024)
    grande.set(PDF)
    fetchMock.mockResolvedValueOnce(new Response(new Blob([grande]).stream(), { status: 200 }))
    const r = await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })
    expect(r).toMatchObject({ resultado: "sin_pdf", motivo: "descarga: supera el límite" })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("nunca tira: Alegra o Resend que fallan → fallo", async () => {
    getDocumentPdf.mockRejectedValueOnce(new Error("Alegra 500"))
    expect(await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).toMatchObject({ resultado: "fallo" })
    sendEmail.mockRejectedValueOnce(new Error("from no verificado"))
    expect(await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).toMatchObject({
      resultado: "fallo",
      destino: "an***@cliente.example",
    })
  })

  it("dry-run (sin RESEND_API_KEY) no se informa como enviado", async () => {
    sendEmail.mockResolvedValueOnce(false)
    expect(await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).toMatchObject({ resultado: "fallo", motivo: "dry-run" })
  })

  it("sin número guardado usa el de Alegra; tenant en modo mock → sin_pdf", async () => {
    await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido({ facturaNumero: null }) })
    expect(sendEmail.mock.calls[0][5].attachments[0].filename).toBe("Factura-00201-00007040.pdf")
    getTenantByIdFromDb.mockResolvedValueOnce({ id: "tenant-a", name: "Tienda Demo", alegraMock: true })
    expect((await enviarFacturaPedido({ tenantId: "tenant-a", pedido: pedido() })).resultado).toBe("sin_pdf")
  })
})
