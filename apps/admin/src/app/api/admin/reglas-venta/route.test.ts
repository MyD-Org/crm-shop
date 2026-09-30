import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * /api/admin/reglas-venta: guard (401/403), validación (400) y éxito con el aviso al Shop. El repo
 * de datos se simula: la DB real se cubre en test/integration/reglas-venta.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } } as Record<string, unknown>,
  ping: 0,
  guardado: [] as unknown[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    state.ping++
    return { propagado: true }
  },
}))
vi.mock("@/lib/reglas-venta-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reglas-venta-repo")>()
  const { REGLAS_VENTA_DEFAULT, validarReglasVenta } = await import("@/lib/reglas-venta-validacion")
  return {
    ...real,
    leerReglasVenta: async () => ({ ...REGLAS_VENTA_DEFAULT }),
    guardarReglasVenta: async (tenant: string, body: unknown) => {
      const v = validarReglasVenta(body)
      if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
      state.guardado.push([tenant, v.cambios])
      return { kind: "ok", reglas: { ...REGLAS_VENTA_DEFAULT, ...v.cambios } }
    },
  }
})

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/reglas-venta", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } }
  state.ping = 0
  state.guardado = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/reglas-venta", () => {
  it("sin sesión → 401 y sin aviso al Shop", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, PUT } = await import("@/app/api/admin/reglas-venta/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await PUT(req("PUT", { reservaDias: 3 }))).status).toBe(401)
    expect(state.ping).toBe(0)
  })

  it("rol desconocido → 403 en usted", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "X", email: "x@cliente.example", role: "visitante" } }
    const { PUT } = await import("@/app/api/admin/reglas-venta/route")
    const res = await PUT(req("PUT", { reservaDias: 3 }))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/No tiene permiso/)
  })

  it("GET devuelve los defaults cuando no hay fila", async () => {
    const { GET } = await import("@/app/api/admin/reglas-venta/route")
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { reglas: { reservaDias: number } }).reglas.reservaDias).toBe(7)
  })

  it("PUT con un negativo → 400 con el mensaje en usted y sin aviso", async () => {
    const { PUT } = await import("@/app/api/admin/reglas-venta/route")
    const res = await PUT(req("PUT", { trasladoDias: -1 }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string; campo: string }
    expect(json.campo).toBe("trasladoDias")
    expect(json.error).toBe("Ingrese un número entero igual o mayor que cero.")
    expect(state.ping).toBe(0)
  })

  it("PUT válido guarda con el tenant del guard y avisa al Shop", async () => {
    const { PUT } = await import("@/app/api/admin/reglas-venta/route")
    const res = await PUT(req("PUT", { reservaDias: 0, tenantId: "otro" }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { propagado: boolean; reglas: { reservaDias: number } }
    expect(json.propagado).toBe(true)
    expect(json.reglas.reservaDias).toBe(0)
    expect(state.guardado).toEqual([["tenant-a", { reservaDias: 0 }]])
    expect(state.ping).toBe(1)
  })
})
