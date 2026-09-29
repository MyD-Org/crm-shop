import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * Rutas de cuentas de Alegra (D lote 1): guard admin+ (operador = 404 idéntico al inexistente,
 * sin sesión = 401), tenant solo del guard, el token nunca en las respuestas y la prueba de
 * conexión sin filtrar detalle. Repo y Alegra se simulan (la DB real: alegra-cuentas-repo.integration).
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  llamadas: [] as unknown[][],
  guardar: (() => ({ kind: "ok", cuenta: null })) as (...a: unknown[]) => unknown,
  config: (() => ({ kind: "ok", config: { alegraEmail: "a", alegraToken: "TOKEN-SECRETO", alegraMock: false } })) as (...a: unknown[]) => unknown,
  prueba: (() => ({ ok: true })) as (...a: unknown[]) => unknown,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/alegra-cuentas-repo", () => ({
  listarCuentas: async (t: string) => {
    state.llamadas.push(["listar", t])
    return { cuentas: [], asignaciones: {} }
  },
  guardarCuentaDeSucursal: async (...a: unknown[]) => {
    state.llamadas.push(["guardar", ...a])
    return state.guardar(...a)
  },
  configDeSucursal: async (...a: unknown[]) => {
    state.llamadas.push(["config", ...a])
    return state.config(...a)
  },
}))
vi.mock("@/lib/alegra", () => ({ probarConexionAlegra: async (c: unknown) => state.prueba(c) }))

const ctx = { params: Promise.resolve({ slug: "mdp" }) }
const req = (body?: unknown) =>
  new Request("http://admin.test/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.llamadas = []
  state.guardar = () => ({ kind: "ok", cuenta: null })
  state.config = () => ({ kind: "ok", config: { alegraEmail: "a", alegraToken: "TOKEN-SECRETO", alegraMock: false } })
  state.prueba = () => ({ ok: true })
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("permisos", () => {
  it("sin sesión → 401 y no toca nada", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET } = await import("@/app/api/admin/alegra-cuentas/route")
    const { PUT } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/route")
    const { POST } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/probar/route")
    expect((await GET(req())).status).toBe(401)
    expect((await PUT(req({ modo: "ninguna" }), ctx)).status).toBe(401)
    expect((await POST(req(), ctx)).status).toBe(401)
    expect(state.llamadas).toEqual([])
  })

  it("un operador no llega (404 igual al de un id inexistente)", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u2", name: "Op", email: "op@cliente.example", role: "operator" } }
    const { GET } = await import("@/app/api/admin/alegra-cuentas/route")
    const { PUT } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/route")
    const { POST } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/probar/route")
    for (const r of [await GET(req()), await PUT(req({ modo: "ninguna" }), ctx), await POST(req(), ctx)]) {
      expect(r.status).toBe(404)
    }
    expect(state.llamadas).toEqual([])
  })
})

describe("PUT cuenta-alegra", () => {
  it("usa el tenant del guard, nunca el del cuerpo", async () => {
    const { PUT } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/route")
    const r = await PUT(req({ modo: "ninguna", tenantId: "tenant-b" }), ctx)
    expect(r.status).toBe(200)
    expect(state.llamadas[0].slice(0, 3)).toEqual(["guardar", "tenant-a", "mdp"])
  })
  it("traduce invalid → 400, conflict → 409 y not_found → 404", async () => {
    const { PUT } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/route")
    state.guardar = () => ({ kind: "invalid", campo: "token", error: "Ingrese el token de la cuenta de Alegra." })
    expect((await PUT(req({}), ctx)).status).toBe(400)
    state.guardar = () => ({ kind: "conflict", campo: "general", error: "x" })
    expect((await PUT(req({}), ctx)).status).toBe(409)
    state.guardar = () => ({ kind: "not_found" })
    expect((await PUT(req({}), ctx)).status).toBe(404)
  })
})

describe("POST cuenta-alegra/probar", () => {
  it("responde el resultado y nunca el token", async () => {
    const { POST } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/probar/route")
    const r = await POST(req({ token: "TOKEN-SECRETO" }), ctx)
    expect(r.status).toBe(200)
    const texto = await r.text()
    expect(JSON.parse(texto)).toEqual({ ok: true })
    expect(texto).not.toContain("TOKEN-SECRETO")
  })
  it("sin cuenta asignada informa el motivo sin llamar a Alegra", async () => {
    state.config = () => ({ kind: "sin_cuenta", error: "La sucursal no tiene una cuenta de Alegra asignada." })
    state.prueba = () => {
      throw new Error("no debería llamarse")
    }
    const { POST } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/probar/route")
    const r = await POST(req(), ctx)
    expect(await r.json()).toEqual({ ok: false, motivo: "sin_cuenta", mensaje: "La sucursal no tiene una cuenta de Alegra asignada." })
  })
  it("sucursal inexistente: 404", async () => {
    state.config = () => ({ kind: "not_found" })
    const { POST } = await import("@/app/api/admin/sucursales/[slug]/cuenta-alegra/probar/route")
    expect((await POST(req(), ctx)).status).toBe(404)
  })
})
