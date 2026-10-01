import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * /api/admin/cuentas-bancarias-shop: guard admin+ (401/404), validación (400), conflicto (409) y
 * éxito con el aviso al Shop. El repo se simula: la DB real se cubre en
 * test/integration/cuentas-bancarias-shop.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  ping: 0,
  resultado: { kind: "ok", cuenta: { id: "c1" } } as Record<string, unknown>,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    state.ping++
    return { propagado: true }
  },
}))
vi.mock("@/lib/cuentas-bancarias-shop-repo", () => ({
  listarCuentas: async () => [],
  crearCuenta: async () => state.resultado,
  actualizarCuenta: async () => state.resultado,
  eliminarCuenta: async () => state.resultado,
}))

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/cuentas-bancarias-shop", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.ping = 0
  state.resultado = { kind: "ok", cuenta: { id: "c1" } }
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/cuentas-bancarias-shop", () => {
  it("sin sesión → 401 y sin aviso", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, POST } = await import("@/app/api/admin/cuentas-bancarias-shop/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await POST(req("POST", {}))).status).toBe(401)
    expect(state.ping).toBe(0)
  })

  it("un operador no entra (404 uniforme)", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u2", name: "Op", email: "op@cliente.example", role: "operator" } }
    const { GET, POST } = await import("@/app/api/admin/cuentas-bancarias-shop/route")
    const { PATCH, DELETE } = await import("@/app/api/admin/cuentas-bancarias-shop/[id]/route")
    expect((await GET(req("GET"))).status).toBe(404)
    expect((await POST(req("POST", {}))).status).toBe(404)
    expect((await PATCH(req("PATCH", {}), ctx)).status).toBe(404)
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(404)
    expect(state.ping).toBe(0)
  })

  it("GET lista las cuentas del tenant", async () => {
    const { GET } = await import("@/app/api/admin/cuentas-bancarias-shop/route")
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cuentas: [] })
  })

  it("alta → 201 y avisa al Shop", async () => {
    const { POST } = await import("@/app/api/admin/cuentas-bancarias-shop/route")
    const res = await POST(req("POST", { alias: "a" }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ ok: true, propagado: true })
    expect(state.ping).toBe(1)
  })

  it("inválido → 400; CBU repetido → 409; sin aviso", async () => {
    const { POST } = await import("@/app/api/admin/cuentas-bancarias-shop/route")
    state.resultado = { kind: "invalid", campo: "sucursalSlugs", error: "Seleccione 'Todas las sucursales' o al menos una sucursal." }
    const inv = await POST(req("POST", {}))
    expect(inv.status).toBe(400)
    expect(await inv.json()).toMatchObject({ code: "invalid", campo: "sucursalSlugs" })
    state.resultado = { kind: "conflict", campo: "cbu", error: "Ya existe una cuenta con ese CBU." }
    expect((await POST(req("POST", {}))).status).toBe(409)
    expect(state.ping).toBe(0)
  })

  it("PATCH y DELETE: éxito y not_found", async () => {
    const { PATCH, DELETE } = await import("@/app/api/admin/cuentas-bancarias-shop/[id]/route")
    expect((await PATCH(req("PATCH", { activa: false }), ctx)).status).toBe(200)
    state.resultado = { kind: "ok" }
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(200)
    expect(state.ping).toBe(2)
    state.resultado = { kind: "not_found" }
    expect((await PATCH(req("PATCH", {}), ctx)).status).toBe(404)
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(404)
    expect(state.ping).toBe(2)
  })
})
