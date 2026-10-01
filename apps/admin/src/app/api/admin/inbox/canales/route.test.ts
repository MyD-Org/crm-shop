import { describe, it, expect, beforeEach, vi } from "vitest"

/** GET/PUT /api/admin/inbox/canales: guard por rol, validación y tenant tomado del guard. */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  saved: null as null | { tenant: string; nombres: Record<string, string> },
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/inbox-canales-repo", () => ({
  listarNombres: async () => ({ a: "Centro" }),
  guardarNombres: async (tenant: string, nombres: Record<string, string>) => {
    state.saved = { tenant, nombres }
  },
}))

const put = (body: unknown) =>
  new Request("http://admin.test/api/admin/inbox/canales", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const get = () => new Request("http://admin.test/api/admin/inbox/canales")
const conRol = (role: string) => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "X", email: "x@cliente.example", role } }
}

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.saved = null
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/inbox/canales", () => {
  it("sin sesión → 401 en GET y PUT", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, PUT } = await import("./route")
    expect((await GET(get())).status).toBe(401)
    expect((await PUT(put({ nombres: {} }))).status).toBe(401)
  })

  it("el operador lee pero no edita", async () => {
    conRol("operator")
    const { GET, PUT } = await import("./route")
    const res = await GET(get())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ nombres: { a: "Centro" } })
    expect((await PUT(put({ nombres: { a: "X" } }))).status).toBe(404)
    expect(state.saved).toBeNull()
  })

  it("admin guarda; el tenant sale del guard, no del body", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(put({ nombres: { a: " Centro " }, tenantId: "tenant-b" }))
    expect(res.status).toBe(200)
    expect(state.saved).toEqual({ tenant: "tenant-a", nombres: { a: "Centro" } })
  })

  it("body inválido → 400 en usted", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(put({ nombres: "x" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Indique los nombres de los canales.")
    expect(state.saved).toBeNull()
  })
})
