import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } } as Record<string, unknown>,
}))
vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))

import { GET } from "./route"

const req = (q?: string) =>
  new Request(`http://admin.test/api/admin/envios/localidades${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`)

describe("GET /api/admin/envios/localidades", () => {
  const original = globalThis.fetch
  beforeEach(() => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "admin" } }
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  it("sin sesión responde 401", async () => {
    state.guarded = { ok: false, reason: "no_session" }
    expect((await GET(req("Posadas"))).status).toBe(401)
  })

  it("q corta devuelve lista vacía sin llamar a Georef", async () => {
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    const res = await GET(req("Pos"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ localidades: [] })
    expect(f).not.toHaveBeenCalled()
  })

  it("devuelve id, nombre y etiqueta", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ localidades: [{ id: "5", nombre: "Posadas", provincia: { nombre: "Misiones" }, categoria: "Localidad simple" }] }),
      )) as unknown as typeof fetch
    const res = await GET(req("Posadas"))
    expect(await res.json()).toEqual({ localidades: [{ id: "5", nombre: "Posadas", etiqueta: "Posadas — Misiones" }] })
  })

  it("Georef caído responde 502 con mensaje en usted", async () => {
    globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch
    const res = await GET(req("Posadas"))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Inténtelo/)
  })
})
