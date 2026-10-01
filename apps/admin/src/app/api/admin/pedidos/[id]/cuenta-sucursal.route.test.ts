import { beforeEach, describe, expect, it, vi } from "vitest"

// Vincular factura y vincular remito de un pedido de sucursal con cuenta propia de Alegra:
// buscan/leen el documento con la config de ESA cuenta, no con la del tenant (principal).
// Repo, Alegra y resolución de cuenta simulados; datos inventados.

const CUENTA_MDP = { id: "tenant-a", alegraEmail: "mdp@cliente.example", alegraToken: "t-mdp", alegraMock: false }

const state = vi.hoisted(() => ({
  pedido: { id: "p1", estado: "pendiente", facturaAlegraId: null, clienteCodigo: "55", sucursal: "mdp", sucursalRegla: null } as Record<string, unknown>,
  cuenta: null as unknown,
}))
const getFacturaPorId = vi.fn()
const getRemisionPorId = vi.fn()
const configAlegraDelPedido = vi.fn()
const enviarFacturaPedido = vi.fn()
const vincularFactura = vi.fn()
const vincularRemito = vi.fn()

vi.mock("@/lib/admin-route-guard", () => ({
  adminNotFoundResponse: () => new Response(null, { status: 404 }),
  requireOperatorPlus: async () => ({ ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }),
  requireAdminPlus: async () => ({ ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }),
}))
vi.mock("@/lib/alegra", () => ({
  AlegraRateLimitError: class extends Error {},
  buscarFacturasPorNumero: vi.fn(),
  buscarRemisionesPorNumero: vi.fn(),
  getFacturaPorId: (...a: unknown[]) => getFacturaPorId(...a),
  getRemisionPorId: (...a: unknown[]) => getRemisionPorId(...a),
}))
vi.mock("@/lib/pedido-cuenta-alegra", () => ({ configAlegraDelPedido: (...a: unknown[]) => configAlegraDelPedido(...a) }))
vi.mock("@/lib/pedido-factura-aviso", () => ({
  enviarFacturaPedido: (...a: unknown[]) => enviarFacturaPedido(...a),
  logAvisoFactura: vi.fn(),
}))
vi.mock("@/lib/pedidos-repo", () => ({
  getPedido: async () => ({ pedido: state.pedido, items: [], remito: null }),
  estadoReservaEmision: () => "ninguna",
  pedidosConFactura: async () => [],
  desvincularFactura: vi.fn(),
  desvincularRemito: vi.fn(),
  vincularFactura: (...a: unknown[]) => vincularFactura(...a),
  vincularRemito: (...a: unknown[]) => vincularRemito(...a),
  toPedidoDetalleDto: () => ({}),
}))

const post = (body: unknown) =>
  new Request("http://admin.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ id: "p1" }) }

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  getFacturaPorId.mockReset().mockResolvedValue({
    alegraId: "9", numero: "0001-9", fecha: "2026-10-01", total: 10, estado: "open", clienteAlegraId: "55", clienteNombre: "Ana",
  })
  getRemisionPorId.mockReset().mockResolvedValue({ alegraId: "8", numero: "R-8", fecha: "2026-10-01", clienteAlegraId: "55", clienteNombre: "Ana" })
  configAlegraDelPedido.mockReset().mockResolvedValue({ ok: true, config: CUENTA_MDP, cuentaSlug: "mdp" })
  enviarFacturaPedido.mockReset().mockResolvedValue({ resultado: "enviado", destino: "a***@cliente.example" })
  vincularFactura.mockReset().mockResolvedValue({ kind: "ok", pedido: state.pedido, items: [], historial: [] })
  vincularRemito.mockReset().mockResolvedValue({ kind: "ok", pedido: state.pedido, items: [], historial: [] })
})

describe("vincular factura (pedido de sucursal con cuenta propia)", () => {
  it("lee la factura con la cuenta de la sucursal", async () => {
    const { POST } = await import("@/app/api/admin/pedidos/[id]/factura/route")
    await POST(post({ alegraId: "9" }), ctx)
    expect(configAlegraDelPedido).toHaveBeenCalledWith("tenant-a", state.pedido)
    expect(getFacturaPorId).toHaveBeenCalledWith(CUENTA_MDP, "9")
  })

  it("sin cuenta resoluble responde el error de la cuenta y no consulta Alegra", async () => {
    configAlegraDelPedido.mockResolvedValue({ ok: false, status: 422, code: "sin_cuenta", error: "Seleccione una cuenta." })
    const { POST } = await import("@/app/api/admin/pedidos/[id]/factura/route")
    const res = await POST(post({ alegraId: "9" }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "sin_cuenta", error: "Seleccione una cuenta." })
    expect(getFacturaPorId).not.toHaveBeenCalled()
  })

  it("el mail con el PDF sale por enviarFacturaPedido con el pedido (que resuelve la cuenta)", async () => {
    const { POST } = await import("@/app/api/admin/pedidos/[id]/factura/route")
    await POST(post({ alegraId: "9" }), ctx)
    expect(enviarFacturaPedido).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }))
  })
})

describe("vincular remito (pedido de sucursal con cuenta propia)", () => {
  it("lee el remito con la cuenta de la sucursal", async () => {
    const { POST } = await import("@/app/api/admin/pedidos/[id]/remito/route")
    await POST(post({ alegraId: "8" }), ctx)
    expect(configAlegraDelPedido).toHaveBeenCalledWith("tenant-a", state.pedido)
    expect(getRemisionPorId).toHaveBeenCalledWith(CUENTA_MDP, "8")
  })
})
