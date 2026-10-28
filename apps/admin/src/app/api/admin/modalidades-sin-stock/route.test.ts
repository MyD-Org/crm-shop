import { describe, it, expect, beforeEach, vi } from "vitest"

/** /api/admin/modalidades-sin-stock: guard, validación y aviso al Shop. El repo se simula. */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  avisos: [] as string[],
  creadas: [] as unknown[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/aviso-shop", () => ({
  avisarShop: async (tenantId: string) => {
    state.avisos.push(tenantId)
    return { propagado: true }
  },
}))
vi.mock("@/lib/modalidades-sin-stock-repo", async () => {
  const { validarModalidad } = await import("@/lib/modalidades-sin-stock-validacion")
  return {
    listarModalidades: async () => [],
    crearModalidad: async (tenant: string, body: unknown) => {
      const v = validarModalidad(body)
      if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
      state.creadas.push([tenant, v.modalidad])
      return { kind: "ok", modalidad: { id: "m1", ...v.modalidad } }
    },
    actualizarModalidad: async () => ({ kind: "not_found" }),
    borrarModalidad: async () => ({ kind: "not_found" }),
  }
})

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/modalidades-sin-stock", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const valido = { nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true }

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.avisos = []
  state.creadas = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/modalidades-sin-stock", () => {
  it("sin sesión → 401 y sin aviso al Shop", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, POST } = await import("@/app/api/admin/modalidades-sin-stock/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await POST(req("POST", valido))).status).toBe(401)
    expect(state.avisos).toEqual([])
  })

  it("POST inválido → 400 con campo y sin aviso", async () => {
    const { POST } = await import("@/app/api/admin/modalidades-sin-stock/route")
    const res = await POST(req("POST", { ...valido, plazoDias: 0 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "invalid", campo: "plazoDias" })
    expect(state.avisos).toEqual([])
  })

  it("POST válido → 201, avisa al Shop del tenant del guard (no del body)", async () => {
    const { POST } = await import("@/app/api/admin/modalidades-sin-stock/route")
    const res = await POST(req("POST", { ...valido, tenantId: "tenant-b" }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ ok: true, propagado: true, modalidad: { id: "m1" } })
    expect(state.avisos).toEqual(["tenant-a"])
    expect((state.creadas[0] as unknown[])[0]).toBe("tenant-a")
  })

  it("DELETE de un id ajeno → 404 sin aviso", async () => {
    const { DELETE } = await import("@/app/api/admin/modalidades-sin-stock/[id]/route")
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({ id: "ajeno" }) })
    expect(res.status).toBe(404)
    expect(state.avisos).toEqual([])
  })
})
