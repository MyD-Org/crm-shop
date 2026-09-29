import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * Rutas de /api/admin/sucursales: guard (401/403), validación (400), conflicto (409) y éxito
 * (200/201) con el aviso al Shop. El repo y el guard de sesión se simulan: la DB real se cubre
 * en test/integration/sucursales-repo.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } } as Record<string, unknown>,
  repo: {} as Record<string, unknown>,
  ping: 0,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    state.ping++
    return { propagado: true }
  },
}))
vi.mock("@/lib/sucursales-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sucursales-repo")>()
  return {
    ...real,
    listarSucursales: async () => [],
    listarZonas: async () => [],
    crearSucursal: async (tenant: string, body: unknown) => (state.repo.crearSucursal as (t: string, b: unknown) => unknown)(tenant, body),
    guardarZona: async (tenant: string, body: unknown) => (state.repo.guardarZona as (t: string, b: unknown) => unknown)(tenant, body),
    eliminarSucursal: async (tenant: string, slug: string) => (state.repo.eliminarSucursal as (t: string, s: string) => unknown)(tenant, slug),
  }
})

const sucursalDto = { slug: "aaa", nombre: "Aaa" }
const req = (body?: unknown) =>
  new Request("http://admin.test/api/admin/sucursales", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } }
  state.ping = 0
  state.repo = {}
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("guard de /api/admin/sucursales", () => {
  it("sin sesión → 401 y no toca el repo ni el Shop", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { POST, GET } = await import("@/app/api/admin/sucursales/route")
    expect((await POST(req({ slug: "aaa" }))).status).toBe(401)
    expect((await GET(req())).status).toBe(401)
    expect(state.ping).toBe(0)
  })

  it("rol desconocido → 403 en usted", async () => {
    state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "X", email: "x@cliente.example", role: "visitante" } }
    const { POST } = await import("@/app/api/admin/sucursales/route")
    const res = await POST(req({ slug: "aaa", nombre: "Aaa" }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("No tiene permiso para administrar las sucursales.")
    expect(state.ping).toBe(0)
  })
})

describe("POST /api/admin/sucursales", () => {
  it("201 con la sucursal y `propagado`; el tenant sale del guard, no del body", async () => {
    let tenantUsado = ""
    state.repo.crearSucursal = (tenant: string) => {
      tenantUsado = tenant
      return { kind: "ok", sucursal: sucursalDto }
    }
    const { POST } = await import("@/app/api/admin/sucursales/route")
    const res = await POST(req({ slug: "aaa", nombre: "Aaa", tenantId: "tenant-b" }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, propagado: true, sucursal: sucursalDto })
    expect(tenantUsado).toBe("tenant-a")
    expect(state.ping).toBe(1)
  })

  it("validación → 400 con el mensaje en usted y sin avisar al Shop", async () => {
    // Repo real (importOriginal), pero la validación corta antes de tocar la DB.
    state.repo.crearSucursal = async (t: string, b: unknown) =>
      (await vi.importActual<typeof import("@/lib/sucursales-repo")>("@/lib/sucursales-repo")).crearSucursal(t, b)
    const { POST } = await import("@/app/api/admin/sucursales/route")
    const res = await POST(req({ slug: "A B", nombre: "Aaa" }))
    expect(res.status).toBe(400)
    const cuerpo = await res.json()
    expect(cuerpo.campo).toBe("slug")
    expect(cuerpo.error).toMatch(/identificador/)
    expect(state.ping).toBe(0)
  })

  it("slug duplicado → 409 'Ya existe una sucursal con ese identificador.'", async () => {
    state.repo.crearSucursal = () => ({ kind: "conflict", campo: "slug", error: "Ya existe una sucursal con ese identificador." })
    const { POST } = await import("@/app/api/admin/sucursales/route")
    const res = await POST(req({ slug: "aaa", nombre: "Aaa" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("Ya existe una sucursal con ese identificador.")
    expect(state.ping).toBe(0)
  })
})

describe("zonas y bajas", () => {
  it("zona sin sucursal → 400 'Seleccione una sucursal.'", async () => {
    state.repo.guardarZona = async (t: string, b: unknown) =>
      (await vi.importActual<typeof import("@/lib/sucursales-repo")>("@/lib/sucursales-repo")).guardarZona(t, b)
    const { PUT } = await import("@/app/api/admin/sucursales/zonas/route")
    const res = await PUT(req({ provincia: "Misiones" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Seleccione una sucursal.")
  })

  it("DELETE de una sucursal en uso → 409 y sin ping; inexistente → 404", async () => {
    const { DELETE } = await import("@/app/api/admin/sucursales/[slug]/route")
    state.repo.eliminarSucursal = () => ({ kind: "conflict", error: "Hay pedidos asignados a esta sucursal. Desactívela en lugar de eliminarla." })
    const enUso = await DELETE(req(), { params: Promise.resolve({ slug: "aaa" }) })
    expect(enUso.status).toBe(409)
    state.repo.eliminarSucursal = () => ({ kind: "not_found" })
    const noHay = await DELETE(req(), { params: Promise.resolve({ slug: "zzz" }) })
    expect(noHay.status).toBe(404)
    expect(state.ping).toBe(0)
  })
})
