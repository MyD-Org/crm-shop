import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * /api/admin/despacho: guard (401/403), validación (400, mensajes en usted) y éxito con el aviso al
 * Shop. El repo de datos se simula: la DB real se cubre en
 * test/integration/despacho-configurable-0093.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  ping: 0,
  propagado: true,
  guardado: [] as unknown[],
  pingTenants: [] as string[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async (tenantId: string) => {
    state.pingTenants.push(tenantId)
    state.ping++
    return { propagado: state.propagado }
  },
}))
vi.mock("@/lib/reglas-venta-repo", async () => {
  const { DESPACHO_DEFAULT, validarDespacho } = await import("@/lib/despacho-validacion")
  return {
    leerDespacho: async () => ({ ...DESPACHO_DEFAULT }),
    guardarDespacho: async (tenant: string, body: unknown) => {
      const v = validarDespacho(body)
      if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
      state.guardado.push([tenant, v.despacho])
      return { kind: "ok", despacho: v.despacho }
    },
  }
})

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/despacho", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.ping = 0
  state.pingTenants = []
  state.propagado = true
  state.guardado = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/despacho", () => {
  it("sin sesión → 401 y sin aviso al Shop", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, PUT } = await import("@/app/api/admin/despacho/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await PUT(req("PUT", { visible: true, diasHabiles: 1 }))).status).toBe(401)
    expect(state.ping).toBe(0)
  })

  it("rol desconocido → 403 y sin guardar", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "X", email: "x@cliente.example", role: "visitante" } }
    const { PUT } = await import("@/app/api/admin/despacho/route")
    expect((await PUT(req("PUT", { visible: true, diasHabiles: 1 }))).status).toBe(403)
    expect(state.guardado).toEqual([])
  })

  it("GET devuelve los defaults: visible, 1 día hábil", async () => {
    const { GET } = await import("@/app/api/admin/despacho/route")
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { despacho: unknown }).despacho).toEqual({ visible: true, diasHabiles: 1 })
  })

  it("PUT con días fuera de rango → 400 con el mensaje en usted y sin aviso", async () => {
    const { PUT } = await import("@/app/api/admin/despacho/route")
    const res = await PUT(req("PUT", { visible: true, diasHabiles: 0 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "Ingrese un número entero de días entre 1 y 30.", code: "invalid", campo: "diasHabiles" })
    expect(state.ping).toBe(0)
  })

  it("PUT con cuerpo roto → 400", async () => {
    const { PUT } = await import("@/app/api/admin/despacho/route")
    const res = await PUT(new Request("http://admin.test/api/admin/despacho", { method: "PUT", body: "{no-json" }))
    expect(res.status).toBe(400)
  })

  it("PUT válido guarda con el tenant del guard (no el del body) y avisa al Shop", async () => {
    const { PUT } = await import("@/app/api/admin/despacho/route")
    const res = await PUT(req("PUT", { tenantId: "otro", visible: false, diasHabiles: "3" }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { propagado: boolean; despacho: unknown }
    expect(json).toMatchObject({ propagado: true, despacho: { visible: false, diasHabiles: 3 } })
    expect(state.guardado).toEqual([["tenant-a", { visible: false, diasHabiles: 3 }]])
    expect(state.pingTenants).toEqual(["tenant-a"])
  })

  it("si el aviso al Shop no propagó, igual guarda y lo informa", async () => {
    state.propagado = false
    const { PUT } = await import("@/app/api/admin/despacho/route")
    const res = await PUT(req("PUT", { visible: true, diasHabiles: 2 }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { propagado: boolean }).propagado).toBe(false)
    expect(state.guardado).toHaveLength(1)
  })
})
