import { describe, it, expect, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  flag: true,
  session: { userId: "u", tenantId: "t", role: "superadmin" } as Record<string, unknown>,
  tenant: [{ id: "t", aiTenantId: "ai-t", aiApiUrl: "http://ai.example" }] as Record<string, unknown>[],
  costs: (async () => ({ month: "2026-10", limit: 1000, numbers: [], errors: [], lastRunAt: null })) as () => Promise<unknown>,
}))

vi.mock("next/headers", () => ({ cookies: async () => ({}) }))
vi.mock("iron-session", () => ({ getIronSession: async () => state.session }))
vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => Promise.resolve(state.tenant) }) }) }),
}))
vi.mock("@/lib/flags", () => ({ botUsagePanelEnabled: async () => state.flag }))
vi.mock("@/lib/inbox-api", () => ({ getWaCosts: () => state.costs() }))

async function get() {
  const { GET } = await import("./route")
  return GET()
}

beforeEach(() => {
  state.flag = true
  state.session = { userId: "u", tenantId: "t", role: "superadmin" }
  state.tenant = [{ id: "t", aiTenantId: "ai-t", aiApiUrl: "http://ai.example" }]
  state.costs = async () => ({ month: "2026-10", limit: 1000, numbers: [], errors: [], lastRunAt: null })
})

describe("GET /api/admin/inbox/wa-costos", () => {
  it("404 con el flag apagado", async () => {
    state.flag = false
    expect((await get()).status).toBe(404)
  })
  it("401 sin sesión", async () => {
    state.session = {}
    expect((await get()).status).toBe(401)
  })
  it("403 si no es superadmin", async () => {
    state.session = { userId: "u", tenantId: "t", role: "admin" }
    expect((await get()).status).toBe(403)
  })
  it("503 sin inbox configurado", async () => {
    state.tenant = [{ id: "t" }]
    expect((await get()).status).toBe(503)
  })
  it("502 si la ai-api falla", async () => {
    state.costs = async () => { throw new Error("ai-api error 404") }
    expect((await get()).status).toBe(502)
  })
  it("200 con el resumen", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect((await res.json()).month).toBe("2026-10")
  })
})
