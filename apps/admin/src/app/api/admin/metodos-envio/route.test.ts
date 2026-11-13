import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * /api/admin/metodos-envio (+ /[id]): guard (401/403), validación (400, mensajes en usted), conflicto
 * (409) y éxito con el aviso al Shop. El repo, el guard y las consultas a Georef/Nominatim se
 * simulan: la DB real se cubre en test/integration/metodos-envio-repo.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } } as Record<string, unknown>,
  ping: 0,
  pingTenants: [] as string[],
  llamadas: [] as unknown[][],
  resultado: { kind: "ok", metodo: { id: "0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b", slug: "envio-en-el-dia" } } as Record<string, unknown>,
  completadas: 0,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async (tenantId: string) => {
    state.ping++
    state.pingTenants.push(tenantId)
    return { propagado: true }
  },
}))
vi.mock("@/lib/metodos-envio-localidades", () => ({
  completarLocalidades: async (locs: { georefId: string }[]) => {
    state.completadas += locs.length
    return locs.map((l) => ({ ...l, centro: { lat: -38, lon: -57.5 }, bbox: null }))
  },
}))
vi.mock("@/lib/metodos-envio-repo", () => ({
  listarMetodos: async (t: string) => {
    state.llamadas.push(["listar", t])
    return []
  },
  crearMetodo: async (...a: unknown[]) => {
    state.llamadas.push(["crear", ...a])
    return state.resultado
  },
  guardarMetodo: async (...a: unknown[]) => {
    state.llamadas.push(["guardar", ...a])
    return state.resultado
  },
  eliminarMetodo: async (...a: unknown[]) => {
    state.llamadas.push(["eliminar", ...a])
    return state.resultado
  },
}))

const ID = "0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b"
const cuadrado = [[[[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95], [-57.6, -37.95], [-57.6, -38.05]]]]
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  nombre: "Envío en el día",
  activo: true,
  provincia: "Buenos Aires",
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00",
  margenMin: 0,
  itemAlegraId: "9001",
  zonas: [{ nombre: "Centro", precio: 3000, geometria: cuadrado }],
  localidades: [{ georefId: "9990001", etiqueta: "Ciudad Ejemplo — Buenos Aires" }],
  ...extra,
})
const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/metodos-envio", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } }
  state.ping = 0
  state.pingTenants = []
  state.llamadas = []
  state.completadas = 0
  state.resultado = { kind: "ok", metodo: { id: ID, slug: "envio-en-el-dia" } }
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("guard", () => {
  it("sin sesión → 401 y no toca nada", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, POST } = await import("@/app/api/admin/metodos-envio/route")
    const { PUT, DELETE } = await import("@/app/api/admin/metodos-envio/[id]/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await POST(req("POST", cuerpo()))).status).toBe(401)
    expect((await PUT(req("PUT", cuerpo()), ctx())).status).toBe(401)
    expect((await DELETE(req("DELETE"), ctx())).status).toBe(401)
    expect(state.llamadas).toEqual([])
    expect(state.ping).toBe(0)
  })

  it("rol desconocido → 403", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "X", email: "x@cliente.example", role: "visitante" } }
    const { POST } = await import("@/app/api/admin/metodos-envio/route")
    const res = await POST(req("POST", cuerpo()))
    expect(res.status).toBe(403)
    expect(state.llamadas).toEqual([])
  })
})

describe("POST /api/admin/metodos-envio", () => {
  it("válido → 201, completa las localidades, guarda con el tenant del guard y avisa al Shop", async () => {
    const { POST } = await import("@/app/api/admin/metodos-envio/route")
    const res = await POST(req("POST", cuerpo()))
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j).toMatchObject({ ok: true, propagado: true, avisos: [] })
    expect(state.completadas).toBe(1)
    expect(state.llamadas[0][0]).toBe("crear")
    expect(state.llamadas[0][1]).toBe("tenant-a")
    expect(state.pingTenants).toEqual(["tenant-a"])
  })

  it("inválido → 400 en usted con el campo, sin guardar ni avisar", async () => {
    const { POST } = await import("@/app/api/admin/metodos-envio/route")
    const res = await POST(req("POST", cuerpo({ horaCorte: "25:00" })))
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j).toMatchObject({ code: "invalid", campo: "horaCorte" })
    expect(j.error).toMatch(/hora de corte/i)
    expect(state.llamadas).toEqual([])
    expect(state.ping).toBe(0)
  })

  it("cuerpo ilegible → 400", async () => {
    const { POST } = await import("@/app/api/admin/metodos-envio/route")
    const res = await POST(new Request("http://admin.test/x", { method: "POST", body: "no es json" }))
    expect(res.status).toBe(400)
  })

  it("slug repetido → 409", async () => {
    state.resultado = { kind: "conflict", campo: "slug", error: "Ya existe un método con ese identificador." }
    const { POST } = await import("@/app/api/admin/metodos-envio/route")
    const res = await POST(req("POST", cuerpo()))
    expect(res.status).toBe(409)
    expect(state.ping).toBe(0)
  })

  it("devuelve los avisos de solape", async () => {
    const { POST } = await import("@/app/api/admin/metodos-envio/route")
    const solapada = [[[[-57.55, -38.05], [-57.45, -38.05], [-57.45, -37.95], [-57.55, -37.95], [-57.55, -38.05]]]]
    const res = await POST(req("POST", cuerpo({ zonas: [{ nombre: "Centro", precio: 3000, geometria: cuadrado }, { nombre: "Costa", precio: 4000, geometria: solapada }] })))
    expect((await res.json()).avisos).toHaveLength(1)
  })
})

describe("GET /api/admin/metodos-envio", () => {
  it("lista los del tenant del guard, sin caché", async () => {
    const { GET } = await import("@/app/api/admin/metodos-envio/route")
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(state.llamadas).toEqual([["listar", "tenant-a"]])
  })
})

describe("/api/admin/metodos-envio/[id]", () => {
  it("PUT válido guarda COMPLETO y avisa al Shop", async () => {
    const { PUT } = await import("@/app/api/admin/metodos-envio/[id]/route")
    const res = await PUT(req("PUT", cuerpo()), ctx())
    expect(res.status).toBe(200)
    expect(state.llamadas[0].slice(0, 3)).toEqual(["guardar", "tenant-a", ID])
    expect(state.ping).toBe(1)
  })
  it("PUT inválido → 400", async () => {
    const { PUT } = await import("@/app/api/admin/metodos-envio/[id]/route")
    expect((await PUT(req("PUT", cuerpo({ margenMin: -1 })), ctx())).status).toBe(400)
    expect(state.ping).toBe(0)
  })
  it("PUT con id que no es uuid → 404 sin tocar el repo", async () => {
    const { PUT } = await import("@/app/api/admin/metodos-envio/[id]/route")
    expect((await PUT(req("PUT", cuerpo()), ctx("no-es-uuid"))).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })
  it("PUT de un método ajeno o inexistente → 404", async () => {
    state.resultado = { kind: "not_found" }
    const { PUT } = await import("@/app/api/admin/metodos-envio/[id]/route")
    expect((await PUT(req("PUT", cuerpo()), ctx())).status).toBe(404)
    expect(state.ping).toBe(0)
  })
  it("DELETE de un método activo → 409", async () => {
    state.resultado = { kind: "conflict", error: "Desactive el método antes de eliminarlo." }
    const { DELETE } = await import("@/app/api/admin/metodos-envio/[id]/route")
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(409)
    expect(state.ping).toBe(0)
  })
  it("DELETE de un inactivo → 200 y avisa", async () => {
    state.resultado = { kind: "ok" }
    const { DELETE } = await import("@/app/api/admin/metodos-envio/[id]/route")
    expect((await DELETE(req("DELETE"), ctx())).status).toBe(200)
    expect(state.ping).toBe(1)
  })
})
