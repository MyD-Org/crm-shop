import { describe, it, expect, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"

/** POST /api/admin/settings/schedule/copiar: guard, validación del body y ping. Repo simulado. */

const state = vi.hoisted(() => ({
  session: { userId: "u1", role: "admin", tenantId: "tenant-a" } as Record<string, unknown>,
  ping: 0,
  llamadas: [] as unknown[],
  resultado: { kind: "ok", destinos: ["sede-sur"] } as Record<string, unknown>,
}))

vi.mock("@/lib/admin-route-guard", () => ({
  adminNotFoundResponse: () => Response.json({ error: "No encontrado", code: "not_found" }, { status: 404 }),
  requireAdminPlus: async () => {
    const s = state.session
    if (!s.userId) return { ok: false, response: Response.json({ error: "No autorizado", code: "unauthorized" }, { status: 401 }) }
    if (s.role === "operator") return { ok: false, response: Response.json({ error: "No encontrado", code: "not_found" }, { status: 404 }) }
    return { ok: true, tenantId: s.tenantId, user: { id: s.userId, name: "Nombre", email: "u@cliente.example", role: s.role } }
  },
}))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    state.ping++
    return { propagado: true }
  },
}))
vi.mock("@/lib/horarios-repo", async () => {
  const real = await vi.importActual<typeof import("@/lib/horarios-repo")>("@/lib/horarios-repo")
  return {
    ...real,
    copiarHorario: async (...args: unknown[]) => {
      state.llamadas.push(args)
      return state.resultado
    },
  }
})

const req = (body: unknown) =>
  new Request("http://admin.test/api/admin/settings/schedule/copiar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest

beforeEach(() => {
  state.session = { userId: "u1", role: "admin", tenantId: "tenant-a" }
  state.ping = 0
  state.llamadas = []
  state.resultado = { kind: "ok", destinos: ["sede-sur"] }
})

describe("POST /api/admin/settings/schedule/copiar", () => {
  it("sin sesión → 401; operator → 404 (mismo cuerpo que un id inexistente)", async () => {
    const { POST } = await import("./route")
    state.session = {}
    expect((await POST(req({ desde: "a", hacia: "todas", que: "todo" }))).status).toBe(401)
    state.session = { userId: "u1", role: "operator", tenantId: "tenant-a" }
    expect((await POST(req({ desde: "a", hacia: "todas", que: "todo" }))).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })

  it.each([
    ["JSON roto", "{no"],
    ["sin desde", { hacia: "todas", que: "todo" }],
    ["que desconocido", { desde: "a", hacia: "todas", que: "nada" }],
    ["hacia inválido", { desde: "a", hacia: 3, que: "todo" }],
    ["hacia con no-strings", { desde: "a", hacia: ["b", 2], que: "todo" }],
  ])("body inválido (%s) → 400 en usted, sin copiar ni avisar", async (_n, body) => {
    const { POST } = await import("./route")
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe("string")
    expect(state.llamadas).toEqual([])
    expect(state.ping).toBe(0)
  })

  it("éxito: usa el tenant de la sesión y avisa al Shop", async () => {
    const { POST } = await import("./route")
    const res = await POST(req({ desde: "sede-norte", hacia: ["sede-sur"], que: "excepciones" }))
    expect(res.status).toBe(200)
    expect(state.llamadas[0]).toEqual(["tenant-a", { desde: "sede-norte", hacia: ["sede-sur"], que: "excepciones" }])
    expect(state.ping).toBe(1)
  })

  it("destino ajeno (repo not_found) → 404 y sin aviso", async () => {
    const { POST } = await import("./route")
    state.resultado = { kind: "not_found" }
    const res = await POST(req({ desde: "sede-norte", hacia: "todas", que: "todo" }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "La sucursal indicada no existe." })
    expect(state.ping).toBe(0)
  })

  it("repo invalid → 400 con su mensaje", async () => {
    const { POST } = await import("./route")
    state.resultado = { kind: "invalid", error: "No hay otras sucursales activas para copiar." }
    const res = await POST(req({ desde: "sede-norte", hacia: "todas", que: "todo" }))
    expect(res.status).toBe(400)
    expect(state.ping).toBe(0)
  })
})
