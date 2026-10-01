import { describe, it, expect, beforeEach, vi } from "vitest"

/** GET detalle de un comprobante desde el pedido: guard operador+ y acotado al pedido y tenant. */

const PEDIDO = "11111111-1111-4111-8111-111111111111"
const OTRO = "22222222-2222-4222-8222-222222222222"
const REC = "33333333-3333-4333-8333-333333333333"

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ope", email: "ope@cliente.example", role: "operator" } } as Record<string, unknown>,
  row: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/payment-receipts", () => ({
  getAdmin: async () => state.row,
  toAdminDtoConPedido: async (_t: string, row: Record<string, unknown>) => ({ id: row.id, dto: true }),
}))

const req = () => new Request("http://admin.test/x")
const ctx = (id: string, receiptId: string) => ({ params: Promise.resolve({ id, receiptId }) })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ope", email: "ope@cliente.example", role: "operator" } }
  state.row = { id: REC, shopOrderId: PEDIDO }
})

describe("GET /api/admin/pedidos/[id]/comprobantes/[receiptId]", () => {
  it("sin sesión → 401", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET } = await import("./route")
    expect((await GET(req(), ctx(PEDIDO, REC))).status).toBe(401)
  })

  it("un operador ve el comprobante de su pedido", async () => {
    const { GET } = await import("./route")
    const res = await GET(req(), ctx(PEDIDO, REC))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: REC, dto: true })
  })

  it("comprobante de otro pedido → 404", async () => {
    state.row = { id: REC, shopOrderId: OTRO }
    const { GET } = await import("./route")
    expect((await GET(req(), ctx(PEDIDO, REC))).status).toBe(404)
  })

  it("inexistente, rechazado o ajeno (el repo devuelve null) → 404", async () => {
    state.row = null
    const { GET } = await import("./route")
    expect((await GET(req(), ctx(PEDIDO, REC))).status).toBe(404)
  })

  it("ids malformados → 404", async () => {
    const { GET } = await import("./route")
    expect((await GET(req(), ctx("x", REC))).status).toBe(404)
    expect((await GET(req(), ctx(PEDIDO, "y"))).status).toBe(404)
  })
})
