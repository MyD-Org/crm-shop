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

const { avisarClientePedido, pedidosUrl } = await import("@/lib/pedido-estado-aviso")

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

describe("avisarClientePedido", () => {
  it("pedido de un tenant nuevo → el mail enlaza a su tienda y no a la histórica", async () => {
    getTenantByIdFromDb.mockResolvedValue({ id: "tenant-b", name: "Tienda B", logoPath: "", shopUrl: "https://b.example" })
    const r = await avisarClientePedido({ tenantId: "tenant-b", pedido, aviso: "en_camino", now: new Date("2026-10-13T12:00:00Z") })
    expect(r).toEqual({ status: "sent" })
    const [, , , html] = sendEmail.mock.calls[0]
    expect(html).toContain("https://b.example/mi-cuenta/pedidos")
    expect(html).not.toContain("legacy.example")
  })
})
