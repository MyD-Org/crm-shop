import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * /api/admin/envios: guard (401/403), validación (400, mensajes en usted) y éxito con el aviso al
 * Shop. El repo de datos se simula: la DB real se cubre en
 * test/integration/envio-configurable-0049.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  ping: 0,
  propagado: true,
  guardado: [] as unknown[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    state.ping++
    return { propagado: state.propagado }
  },
}))
vi.mock("@/lib/reglas-venta-repo", async () => {
  const { ENVIO_DEFAULT, validarEnvio } = await import("@/lib/envios-validacion")
  return {
    leerEnvio: async () => ({ ...ENVIO_DEFAULT }),
    guardarEnvio: async (tenant: string, body: unknown) => {
      const v = validarEnvio(body)
      if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
      state.guardado.push([tenant, v.envio])
      return { kind: "ok", envio: v.envio }
    },
  }
})

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/envios", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.ping = 0
  state.propagado = true
  state.guardado = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/envios", () => {
  it("sin sesión → 401 y sin aviso al Shop", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, PUT } = await import("@/app/api/admin/envios/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await PUT(req("PUT", { domicilioActivo: true, gratisActivo: false }))).status).toBe(401)
    expect(state.ping).toBe(0)
  })

  it("rol desconocido → 403 y sin guardar", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "X", email: "x@cliente.example", role: "visitante" } }
    const { PUT } = await import("@/app/api/admin/envios/route")
    const res = await PUT(req("PUT", { domicilioActivo: true, gratisActivo: false }))
    expect(res.status).toBe(403)
    expect(state.guardado).toEqual([])
  })

  it("GET devuelve los defaults: domicilio activo y gratis apagado", async () => {
    const { GET } = await import("@/app/api/admin/envios/route")
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { envio: { domicilioActivo: boolean; gratisActivo: boolean } }).envio).toMatchObject({
      domicilioActivo: true,
      gratisActivo: false,
    })
  })

  it("PUT con gratis Sí sin provincias → 400 con el mensaje en usted y sin aviso", async () => {
    const { PUT } = await import("@/app/api/admin/envios/route")
    const res = await PUT(
      req("PUT", { domicilioActivo: true, gratisActivo: true, alcance: "provincias", provincias: [], minimoModo: "sin_minimo" }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "Seleccione al menos una provincia.", code: "invalid", campo: "provincias" })
    expect(state.ping).toBe(0)
  })

  it("PUT con monto mínimo en cero → 400", async () => {
    const { PUT } = await import("@/app/api/admin/envios/route")
    const res = await PUT(req("PUT", { domicilioActivo: true, gratisActivo: true, alcance: "pais", minimoModo: "desde", minimo: 0 }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe("Ingrese un monto mayor a cero.")
  })

  it("PUT con cuerpo roto → 400", async () => {
    const { PUT } = await import("@/app/api/admin/envios/route")
    const res = await PUT(new Request("http://admin.test/api/admin/envios", { method: "PUT", body: "{no-json" }))
    expect(res.status).toBe(400)
  })

  it("PUT válido guarda con el tenant del guard (no el del body) y avisa al Shop", async () => {
    const { PUT } = await import("@/app/api/admin/envios/route")
    const res = await PUT(
      req("PUT", {
        tenantId: "otro",
        domicilioActivo: true,
        gratisActivo: true,
        alcance: "provincias",
        provincias: ["Misiones"],
        minimoModo: "desde",
        minimo: 100000,
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { propagado: boolean; envio: { provincias: string[]; minimo: number } }
    expect(json.propagado).toBe(true)
    expect(json.envio).toMatchObject({ provincias: ["misiones"], minimo: 100000 })
    expect(state.guardado).toHaveLength(1)
    expect((state.guardado[0] as [string])[0]).toBe("tenant-a")
    expect(state.ping).toBe(1)
  })

  it("si el aviso al Shop no propagó, igual guarda y lo informa", async () => {
    state.propagado = false
    const { PUT } = await import("@/app/api/admin/envios/route")
    const res = await PUT(req("PUT", { domicilioActivo: false, gratisActivo: false }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { propagado: boolean }).propagado).toBe(false)
    expect(state.guardado).toHaveLength(1)
  })
})
