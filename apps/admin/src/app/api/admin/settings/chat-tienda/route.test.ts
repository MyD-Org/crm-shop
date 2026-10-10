import { beforeEach, describe, expect, it, vi } from "vitest"

/** /api/admin/settings/chat-tienda: guard, validación en usted y UPDATE sólo del tenant del guard. */

const state = vi.hoisted(() => ({
  session: { userId: "u1", role: "admin", tenantId: "tenant-a" } as Record<string, unknown>,
  fila: [] as unknown[],
  updates: [] as { set: Record<string, unknown>; where: unknown }[],
}))

vi.mock("@/lib/admin-route-guard", () => ({
  requireAdminPlus: async () => {
    const s = state.session
    if (!s.userId) return { ok: false, response: Response.json({ error: "No autorizado" }, { status: 401 }) }
    if (s.role === "operator") return { ok: false, response: Response.json({ error: "No encontrado" }, { status: 404 }) }
    return { ok: true, tenantId: s.tenantId }
  },
}))
vi.mock("drizzle-orm", async () => {
  const real = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm")
  return { ...real, eq: (_col: unknown, valor: unknown) => ({ eq: valor }) }
})
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(state.fila) }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          state.updates.push({ set, where })
          return Promise.resolve()
        },
      }),
    }),
  }),
}))

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/settings/chat-tienda", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.session = { userId: "u1", role: "admin", tenantId: "tenant-a" }
  state.fila = []
  state.updates = []
})

describe("/api/admin/settings/chat-tienda", () => {
  it("sin sesión → 401; operator → 404 y no escribe", async () => {
    const { GET, PUT } = await import("./route")
    state.session = {}
    expect((await GET(req("GET"))).status).toBe(401)
    state.session = { userId: "u1", role: "operator", tenantId: "tenant-a" }
    expect((await PUT(req("PUT", { emptyState: "x" }))).status).toBe(404)
    expect(state.updates).toEqual([])
  })

  it("GET devuelve lo guardado, o vacío si no hay fila", async () => {
    const { GET } = await import("./route")
    expect(await (await GET(req("GET"))).json()).toEqual({ emptyState: "", suggestions: [] })
    state.fila = [{ emptyState: "Hola", suggestions: ["Una"] }]
    expect(await (await GET(req("GET"))).json()).toEqual({ emptyState: "Hola", suggestions: ["Una"] })
  })

  it("PUT válido guarda limpio, sólo en el tenant del guard (ignora tenantId del body)", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { tenantId: "otro", emptyState: " Consultas ", suggestions: ["A", "", "B"] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, emptyState: "Consultas", suggestions: ["A", "B"] })
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].set).toMatchObject({ chatEmptyState: "Consultas", chatSuggestions: ["A", "B"] })
    expect(state.updates[0].where).toEqual({ eq: "tenant-a" })
  })

  it("PUT inválido → 400 con el error en usted y sin escribir", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { suggestions: ["a", "b", "c", "d", "e"] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/^Indique hasta 4/)
    expect(state.updates).toEqual([])
  })
})
