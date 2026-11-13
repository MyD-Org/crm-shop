import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PedidoRow } from "@/lib/pedidos-repo"

// Mails de estado de un pedido de invitado (change `compra-como-invitado`, S3b): «Pagar su pedido»
// con link firmado y «Cree su cuenta» en lugar de «Ver mis pedidos». Tenant y mail simulados.

const sendEmail = vi.fn()
const getTenantByIdFromDb = vi.fn()

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}))
vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: (...a: unknown[]) => getTenantByIdFromDb(...a) }))

const { avisarClientePedido } = await import("@/lib/pedido-estado-aviso")

const VALOR_PRUEBA = "secreto-de-prueba-pedido-link-0123456789"
const ID = "11111111-1111-4111-8111-111111111111"
const tenant = { id: "tenant-b", name: "Tienda B", logoPath: "", shopUrl: "https://b.example" }
const now = new Date("2026-11-13T12:00:00Z")

const invitado = {
  id: ID,
  numero: 7,
  tenantId: "tenant-b",
  clienteEmail: "ana@cliente.example",
  contactoNombre: "Ana",
  entregaTipo: "retiro",
  compraInvitado: true,
  clerkUserId: null,
  clienteCodigo: null,
  estado: "pendiente",
  pagoEstado: "pendiente",
  pagoMetodo: "mercadopago",
  sitioOrigen: null,
  createdAt: new Date("2026-11-13T10:00:00Z"),
  reservaVenceEn: new Date("2026-11-13T22:00:00Z"),
} as unknown as PedidoRow

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue(true)
  getTenantByIdFromDb.mockReset().mockResolvedValue(tenant)
  vi.stubEnv("PEDIDO_LINK_SECRET", VALOR_PRUEBA)
})
afterEach(() => vi.unstubAllEnvs())

async function enviar(p: PedidoRow, aviso: "confirmado" | "cancelado" | "pago_recibido" = "confirmado") {
  await avisarClientePedido({ tenantId: "tenant-b", pedido: p, aviso, now })
  const [, , , html, text] = sendEmail.mock.calls[0]
  return { html: html as string, text: text as string }
}

function vencimientoDelLink(text: string): number {
  const token = /\/pagar\/(v1\.\S+)/.exec(text)![1]
  return parseInt(token.split(".")[2], 36)
}

describe("pedido de invitado", () => {
  it("pendiente de pago en línea: «Pagar su pedido» firmado y «Cree su cuenta», sin Mi cuenta", async () => {
    const { html, text } = await enviar(invitado)
    expect(html).toContain("Pagar su pedido")
    expect(html).toContain(`https://b.example/pagar/v1.${ID}.`)
    expect(html).toContain("Cree su cuenta")
    expect(html).toContain("https://b.example/registro?email=ana%40cliente.example")
    expect(html).not.toContain("Ver mis pedidos")
    expect(html).not.toContain("/mi-cuenta/pedidos")
    expect(text).toContain("Pagar su pedido: https://b.example/pagar/")
    expect(text).not.toContain("/mi-cuenta")
  })

  it("el link vence con la reserva del pedido", async () => {
    const { text } = await enviar(invitado)
    expect(vencimientoDelLink(text)).toBe(new Date("2026-11-13T22:00:00Z").getTime())
  })

  it("reserva infinita: 24 h desde la creación", async () => {
    const { text } = await enviar({ ...invitado, reservaVenceEn: new Date(NaN) } as unknown as PedidoRow)
    expect(vencimientoDelLink(text)).toBe(new Date("2026-11-14T10:00:00Z").getTime())
  })

  it("reserva a más de 30 días: tope de 30 días desde la creación", async () => {
    const { text } = await enviar({ ...invitado, reservaVenceEn: new Date("2027-06-01T00:00:00Z") } as unknown as PedidoRow)
    expect(vencimientoDelLink(text)).toBe(new Date("2026-12-13T10:00:00Z").getTime())
  })

  it("sin PEDIDO_LINK_SECRET: el mail sale igual, sin «Pagar su pedido» y con «Cree su cuenta» como botón", async () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "")
    const { html } = await enviar(invitado)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(html).not.toContain("Pagar su pedido")
    expect(html).not.toContain("/pagar/")
    expect(html).toContain("Cree su cuenta")
  })

  it("pago pendiente y pago fallido: con link; pagado: sin link y con «Cree su cuenta»", async () => {
    expect((await enviar({ ...invitado, pagoEstado: "fallido" } as unknown as PedidoRow)).html).toContain("Pagar su pedido")
    sendEmail.mockClear()
    const pagado = await enviar({ ...invitado, pagoEstado: "pagado" } as unknown as PedidoRow, "pago_recibido")
    expect(pagado.html).not.toContain("Pagar su pedido")
    expect(pagado.html).toContain("Cree su cuenta")
  })

  it("cancelado: sin «Pagar su pedido»", async () => {
    const { html } = await enviar({ ...invitado, estado: "cancelado" } as unknown as PedidoRow, "cancelado")
    expect(html).not.toContain("Pagar su pedido")
    expect(html).toContain("Cree su cuenta")
  })

  it("transferencia: sin «Pagar su pedido» (no hay a dónde pagar en la web)", async () => {
    const { html } = await enviar({ ...invitado, pagoMetodo: "transferencia" } as unknown as PedidoRow)
    expect(html).not.toContain("Pagar su pedido")
    expect(html).toContain("Cree su cuenta")
  })

  it("pedido de otro sitio del tenant: los links van a ese dominio", async () => {
    getTenantByIdFromDb.mockResolvedValue({ ...tenant, shopDestinosExtra: [{ etiqueta: "otro", url: "https://tienda-b.example" }] })
    const { html } = await enviar({ ...invitado, sitioOrigen: "https://tienda-b.example" } as unknown as PedidoRow)
    expect(html).toContain("https://tienda-b.example/pagar/")
    expect(html).toContain("https://tienda-b.example/registro?email=")
    expect(html).not.toContain("https://b.example/")
  })

  it("tenant sin tienda configurada: sin ningún link (y sin romper el envío)", async () => {
    getTenantByIdFromDb.mockResolvedValue({ id: "tenant-b", name: "Tienda B", logoPath: "" })
    vi.stubEnv("NEXT_PUBLIC_SHOP_URL", "")
    const { html } = await enviar(invitado)
    expect(html).not.toContain("Pagar su pedido")
    expect(html).not.toContain("Cree su cuenta")
  })
})

describe("pedido con cuenta: sin cambios", () => {
  const base = { ...invitado, compraInvitado: false, clerkUserId: "user-1" }

  it("compra normal: «Ver mis pedidos», sin links de invitado", async () => {
    const { html } = await enviar(base as unknown as PedidoRow)
    expect(html).toContain("Ver mis pedidos")
    expect(html).toContain("https://b.example/mi-cuenta/pedidos")
    expect(html).not.toContain("Pagar su pedido")
    expect(html).not.toContain("Cree su cuenta")
  })

  it("invitado ya reclamado (clerk_user_id) o vinculado (cliente_codigo): como una cuenta", async () => {
    for (const extra of [{ clerkUserId: "user-1", clienteCodigo: null }, { clerkUserId: null, clienteCodigo: "C1" }]) {
      sendEmail.mockClear()
      const { html } = await enviar({ ...invitado, ...extra } as unknown as PedidoRow)
      expect(html).toContain("https://b.example/mi-cuenta/pedidos")
      expect(html).not.toContain("Pagar su pedido")
      expect(html).not.toContain("Cree su cuenta")
    }
  })
})
