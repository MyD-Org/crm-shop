import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PedidoRow } from "@/lib/pedidos-repo"

// El enlace "Ver mis pedidos" del mail sale de la tienda DEL TENANT del pedido. Tenant y mail
// simulados; nada sale a la red.

const sendEmail = vi.fn()
const getTenantByIdFromDb = vi.fn()

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}))
vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: (...a: unknown[]) => getTenantByIdFromDb(...a) }))

const { avisarClientePedido, logAviso, pedidosUrl } = await import("@/lib/pedido-estado-aviso")

const pedido = {
  id: "11111111-1111-4111-8111-111111111111",
  numero: 7,
  clienteEmail: "ana@cliente.example",
  contactoNombre: "Ana",
  entregaTipo: "retiro",
} as unknown as PedidoRow

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue(true)
  getTenantByIdFromDb.mockReset()
  vi.stubEnv("NEXT_PUBLIC_SHOP_URL", "https://legacy.example/")
})
afterEach(() => vi.unstubAllEnvs())

describe("pedidosUrl", () => {
  it("tenant con tienda propia: enlace a su tienda", () => {
    expect(pedidosUrl({ id: "tenant-b", shopUrl: "https://b.example/" })).toBe("https://b.example/mi-cuenta/pedidos")
  })
  it("tenant sin tienda propia y sin SHOP_TENANT_LEGACY: la de siempre", () => {
    expect(pedidosUrl({ id: "tenant-a" })).toBe("https://legacy.example/mi-cuenta/pedidos")
  })
  it("con SHOP_TENANT_LEGACY de otro tenant no se enlaza a la tienda histórica", () => {
    vi.stubEnv("SHOP_TENANT_LEGACY", "tenant-a")
    expect(pedidosUrl({ id: "tenant-b" })).toBeNull()
  })
})

describe("pedidosUrl por sitio de origen", () => {
  const tenant = {
    id: "tenant-b",
    shopUrl: "https://b.example",
    shopDestinosExtra: [{ etiqueta: "otro", url: "https://tienda-b.example" }],
  }
  it("pedido hecho en el extra → enlace al extra", () => {
    expect(pedidosUrl(tenant, "https://tienda-b.example")).toBe("https://tienda-b.example/mi-cuenta/pedidos")
  })
  it("sin sitio o sitio ajeno → principal", () => {
    expect(pedidosUrl(tenant, null)).toBe("https://b.example/mi-cuenta/pedidos")
    expect(pedidosUrl(tenant, "https://ajeno.example")).toBe("https://b.example/mi-cuenta/pedidos")
  })
})

describe("avisarClientePedido", () => {
  it("pedido hecho en el segundo dominio → el mail enlaza a ese dominio", async () => {
    getTenantByIdFromDb.mockResolvedValue({
      id: "tenant-b",
      name: "Tienda B",
      logoPath: "",
      shopUrl: "https://b.example",
      shopDestinosExtra: [{ etiqueta: "otro", url: "https://tienda-b.example" }],
    })
    await avisarClientePedido({
      tenantId: "tenant-b",
      pedido: { ...pedido, sitioOrigen: "https://tienda-b.example" } as PedidoRow,
      aviso: "en_camino",
      now: new Date("2026-10-13T12:00:00Z"),
    })
    const [, , , html] = sendEmail.mock.calls[0]
    expect(html).toContain("https://tienda-b.example/mi-cuenta/pedidos")
    expect(html).not.toContain("https://b.example/mi-cuenta")
  })

  it("pedido de un tenant nuevo → el mail enlaza a su tienda y no a la histórica", async () => {
    getTenantByIdFromDb.mockResolvedValue({ id: "tenant-b", name: "Tienda B", logoPath: "", shopUrl: "https://b.example" })
    const r = await avisarClientePedido({ tenantId: "tenant-b", pedido, aviso: "en_camino", now: new Date("2026-10-13T12:00:00Z") })
    expect(r).toEqual({ status: "sent" })
    const [, , , html] = sendEmail.mock.calls[0]
    expect(html).toContain("https://b.example/mi-cuenta/pedidos")
    expect(html).not.toContain("legacy.example")
  })
})

describe("avisarClientePedido: marca por sitio", () => {
  const tenantConSitioPropio = {
    id: "tenant-b",
    name: "Empresa B",
    logoPath: "https://b.example/logo-principal.png",
    resendFrom: "ventas@b.example",
    shopUrl: "https://b.example",
    shopDestinosExtra: [
      {
        etiqueta: "tienda-b",
        url: "https://tienda-b.example",
        marca: { nombre: "Tienda B", logoMailUrl: "https://tienda-b.example/logo-mail.png" },
        remitente: "pedidos@tienda-b.example",
      },
    ],
  }
  const now = new Date("2026-10-13T12:00:00Z")

  it("pedido del sitio propio → nombre, logo y remitente de ese sitio", async () => {
    getTenantByIdFromDb.mockResolvedValue(tenantConSitioPropio)
    await avisarClientePedido({ tenantId: "tenant-b", pedido: { ...pedido, sitioOrigen: "https://tienda-b.example" } as PedidoRow, aviso: "en_camino", now })
    const [tenantEnvio, , , html] = sendEmail.mock.calls[0]
    expect(tenantEnvio).toMatchObject({ name: "Tienda B", resendFrom: "pedidos@tienda-b.example" })
    expect(html).toContain("https://tienda-b.example/logo-mail.png")
    expect(html).not.toContain("logo-principal.png")
  })

  it("pedido sin sitio de origen → marca, logo y remitente del principal", async () => {
    getTenantByIdFromDb.mockResolvedValue(tenantConSitioPropio)
    await avisarClientePedido({ tenantId: "tenant-b", pedido: { ...pedido, sitioOrigen: null } as PedidoRow, aviso: "en_camino", now })
    const [tenantEnvio, , , html] = sendEmail.mock.calls[0]
    expect(tenantEnvio).toMatchObject({ name: "Empresa B", resendFrom: "ventas@b.example" })
    expect(html).toContain("https://b.example/logo-principal.png")
    expect(html).not.toContain("logo-mail.png")
  })

  it("Resend rechaza el envío (dominio no verificado) → se registra y no tira", async () => {
    getTenantByIdFromDb.mockResolvedValue(tenantConSitioPropio)
    sendEmail.mockRejectedValue(new Error("The tienda-b.example domain is not verified"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const r = await avisarClientePedido({ tenantId: "tenant-b", pedido: { ...pedido, sitioOrigen: "https://tienda-b.example" } as PedidoRow, aviso: "en_camino", now })
    expect(r).toEqual({ status: "failed", error: "The tienda-b.example domain is not verified" })
    logAviso("estado", { tenant: "tenant-b", orderId: "p1" }, r)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
