import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * /api/admin/medios-pago-shop: guard admin+ (401/404), validación (400), conflicto (409) y éxito
 * con el aviso al Shop. El repo se simula: la DB real se cubre en
 * test/integration/medios-pago-shop.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
  ping: 0,
  resultado: { kind: "ok", medio: { slug: "efectivo" } } as Record<string, unknown>,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    state.ping++
    return { propagado: true }
  },
}))
vi.mock("@/lib/medios-pago-shop-repo", () => ({
  listarMediosPagoConAvisos: async () => ({
    medios: [{ slug: "efectivo", avisos: ["aviso"] }],
    listas: [{ id: "l1", nombre: "Lista" }],
    listaReferencia: { id: "l0", nombre: "Lista Cuotas" },
  }),
  conAvisos: async (_t: string, medios: Record<string, unknown>[]) => medios.map((m) => ({ ...m, avisos: [] })),
  listasDisponiblesParaMedios: async () => [{ id: "l1", nombre: "Lista" }],
  crearMedioPago: async () => state.resultado,
  actualizarMedioPago: async () => state.resultado,
  eliminarMedioPago: async () => state.resultado,
}))

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/medios-pago-shop", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ slug: "efectivo" }) }

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  state.ping = 0
  state.resultado = { kind: "ok", medio: { slug: "efectivo" } }
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("/api/admin/medios-pago-shop", () => {
  it("sin sesión → 401 y sin aviso", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET, POST } = await import("@/app/api/admin/medios-pago-shop/route")
    expect((await GET(req("GET"))).status).toBe(401)
    expect((await POST(req("POST", {}))).status).toBe(401)
    expect(state.ping).toBe(0)
  })

  it("un operador no entra (404 uniforme)", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u2", name: "Op", email: "op@cliente.example", role: "operator" } }
    const { GET, POST } = await import("@/app/api/admin/medios-pago-shop/route")
    const { PATCH, DELETE } = await import("@/app/api/admin/medios-pago-shop/[slug]/route")
    expect((await GET(req("GET"))).status).toBe(404)
    expect((await POST(req("POST", {}))).status).toBe(404)
    expect((await PATCH(req("PATCH", {}), ctx)).status).toBe(404)
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(404)
    expect(state.ping).toBe(0)
  })

  it("alta → 201 y avisa al Shop", async () => {
    const { POST } = await import("@/app/api/admin/medios-pago-shop/route")
    const res = await POST(req("POST", { slug: "efectivo", nombre: "Efectivo" }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ ok: true, propagado: true })
    expect(state.ping).toBe(1)
  })

  it("slug duplicado → 409; inválido → 400; sin aviso", async () => {
    const { POST } = await import("@/app/api/admin/medios-pago-shop/route")
    state.resultado = { kind: "conflict", campo: "slug", error: "Ya existe un medio de pago con ese identificador." }
    const dup = await POST(req("POST", { slug: "efectivo", nombre: "x" }))
    expect(dup.status).toBe(409)
    expect(await dup.json()).toMatchObject({ code: "conflict", campo: "slug" })
    state.resultado = { kind: "invalid", campo: "nombre", error: "Ingrese el nombre." }
    expect((await POST(req("POST", {}))).status).toBe(400)
    expect(state.ping).toBe(0)
  })

  it("PATCH y DELETE: éxito, not_found y conflicto de borrado", async () => {
    const { PATCH, DELETE } = await import("@/app/api/admin/medios-pago-shop/[slug]/route")
    expect((await PATCH(req("PATCH", { activo: false }), ctx)).status).toBe(200)
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(200)
    expect(state.ping).toBe(2)
    state.resultado = { kind: "not_found" }
    expect((await PATCH(req("PATCH", {}), ctx)).status).toBe(404)
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(404)
    state.resultado = { kind: "conflict", error: "Hay pedidos que eligieron este medio de pago. Desactívelo en lugar de eliminarlo." }
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(409)
    expect(state.ping).toBe(2)
  })

  it("GET trae los medios con avisos y las listas disponibles", async () => {
    const { GET } = await import("@/app/api/admin/medios-pago-shop/route")
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      medios: [{ slug: "efectivo", avisos: ["aviso"] }],
      listas: [{ id: "l1", nombre: "Lista" }],
      listaReferencia: { id: "l0", nombre: "Lista Cuotas" },
    })
  })

  it("PATCH de destacado, ficha o activo avisa al Shop una vez cada uno", async () => {
    const { PATCH } = await import("@/app/api/admin/medios-pago-shop/[slug]/route")
    for (const cambio of [{ activo: false }, { destacarEnCatalogo: true }, { mostrarEnFicha: true }]) {
      expect((await PATCH(req("PATCH", cambio), ctx)).status).toBe(200)
    }
    expect(state.ping).toBe(3)
  })

  it("PATCH inválido → 400 con el campo y sin aviso al Shop", async () => {
    const { PATCH } = await import("@/app/api/admin/medios-pago-shop/[slug]/route")
    state.resultado = { kind: "invalid", campo: "nombre", error: "Ingrese el nombre." }
    const res = await PATCH(req("PATCH", { nombre: "" }), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "invalid", campo: "nombre" })
    expect(state.ping).toBe(0)
  })

  it("destacados simultáneos: el conflicto sale como 409 controlado y sin aviso", async () => {
    const { PATCH } = await import("@/app/api/admin/medios-pago-shop/[slug]/route")
    state.resultado = { kind: "conflict", campo: "destacarEnCatalogo", error: "Otro medio de pago se destacó al mismo tiempo." }
    const res = await PATCH(req("PATCH", { destacarEnCatalogo: true }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "conflict", campo: "destacarEnCatalogo" })
    expect(state.ping).toBe(0)
  })
})
