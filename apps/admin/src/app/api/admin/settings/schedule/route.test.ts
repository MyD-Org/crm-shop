import { describe, it, expect, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * /api/admin/settings/schedule: guard, `?sucursal=`, 404 en usted y ping al Shop. El repo se
 * simula; la DB real se cubre en test/integration/horarios-sucursal-0051.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  session: { userId: "u1", role: "admin", tenantId: "tenant-a" } as Record<string, unknown>,
  ping: 0,
  leer: [] as unknown[],
  guardar: [] as unknown[],
  existe: true,
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
  const { emptySchedule } = await import("@/lib/schedule")
  return {
    ...real,
    leerHorario: async (...args: unknown[]) => {
      state.leer.push(args)
      return state.existe ? { kind: "ok", schedule: emptySchedule(), exceptions: [] } : { kind: "not_found" }
    },
    guardarHorario: async (...args: unknown[]) => {
      state.guardar.push(args)
      return state.existe ? { kind: "ok" } : { kind: "not_found" }
    },
  }
})

const req = (method: string, query = "", body?: unknown) => {
  const url = `http://admin.test/api/admin/settings/schedule${query}`
  const r = new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return Object.assign(r, { nextUrl: new URL(url) }) as unknown as NextRequest
}

const valido = { schedule: { monday: [{ open: "09:00", close: "18:00" }] }, exceptions: [] }

beforeEach(() => {
  state.session = { userId: "u1", role: "admin", tenantId: "tenant-a" }
  state.ping = 0
  state.leer = []
  state.guardar = []
  state.existe = true
})

describe("/api/admin/settings/schedule", () => {
  it("sin sesión → 401; operator → 404 (mismo cuerpo que un id inexistente)", async () => {
    const { GET, PUT } = await import("./route")
    state.session = {}
    expect((await GET(req("GET"))).status).toBe(401)
    state.session = { userId: "u1", role: "operator", tenantId: "tenant-a" }
    expect((await GET(req("GET"))).status).toBe(404)
    expect((await PUT(req("PUT", "", valido))).status).toBe(404)
    expect(state.guardar).toEqual([])
  })

  it("sin ?sucursal= opera sobre la empresa y no avisa al Shop", async () => {
    const { GET, PUT } = await import("./route")
    expect((await GET(req("GET"))).status).toBe(200)
    expect(state.leer).toEqual([["tenant-a", null]])
    expect((await PUT(req("PUT", "", valido))).status).toBe(200)
    expect((state.guardar[0] as unknown[]).slice(0, 2)).toEqual(["tenant-a", null])
    expect(state.ping).toBe(0)
  })

  it("con ?sucursal= guarda en esa sucursal, con el tenant de la sesión, y avisa al Shop", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", "?sucursal=sede-sur", valido))
    expect(res.status).toBe(200)
    expect((state.guardar[0] as unknown[]).slice(0, 2)).toEqual(["tenant-a", "sede-sur"])
    expect(state.ping).toBe(1)
  })

  it("slug inexistente o ajeno → 404 en usted, sin aviso", async () => {
    const { GET, PUT } = await import("./route")
    state.existe = false
    const g = await GET(req("GET", "?sucursal=de-otro"))
    expect(g.status).toBe(404)
    expect(await g.json()).toEqual({ error: "La sucursal indicada no existe." })
    expect((await PUT(req("PUT", "?sucursal=de-otro", valido))).status).toBe(404)
    expect(state.ping).toBe(0)
  })

  it("franjas inválidas → 400 y no persiste", async () => {
    const { PUT } = await import("./route")
    const malo = { schedule: { monday: [{ open: "18:00", close: "09:00" }] }, exceptions: [] }
    expect((await PUT(req("PUT", "?sucursal=sede-sur", malo))).status).toBe(400)
    expect(state.guardar).toEqual([])
    expect(state.ping).toBe(0)
  })
})
