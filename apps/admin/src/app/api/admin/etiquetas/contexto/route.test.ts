import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/admin/etiquetas/contexto: guard admin+ (401 sin sesión, 404 operador), tenant del guard
 * y shopUrl de la función de URL pública. El repo de sucursales/marcas y el tenant se simulan; la
 * DB real se cubre en test/integration/etiquetas-contexto.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  guarded: {} as Record<string, unknown>,
  tenants: {} as Record<string, { id: string; name: string; subtitle: string; logoPath: string; shopUrl?: string }>,
  pedidos: [] as string[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/tenants", () => ({
  getTenantByIdFromDb: async (id: string) => {
    state.pedidos.push(`tenant:${id}`)
    return state.tenants[id] ?? null
  },
}))
vi.mock("@/lib/sucursales-repo", () => ({
  listarSucursales: async (id: string) => {
    state.pedidos.push(`sucursales:${id}`)
    return id === "tenant-a"
      ? [{ slug: "igz", nombre: "Iguazú", direccion: "Calle 1", ciudad: "Iguazú", whatsapp: "5491100000000", activa: true, orden: 0 }]
      : []
  },
}))
vi.mock("@/lib/precios-online-repo", () => ({
  listarMarcas: async (id: string) => {
    state.pedidos.push(`marcas:${id}`)
    return id === "tenant-a" ? [{ clave: "acme", nombre: "ACME" }] : []
  },
}))

const req = () => new Request("http://admin.test/api/admin/etiquetas/contexto")
const admin = (tenantId: string, role = "admin") => ({
  ok: true,
  tenantId,
  user: { id: "u1", name: "Ana", email: "ana@cliente.example", role, canalesPermitidos: null },
})

beforeEach(() => {
  state.guarded = admin("tenant-a")
  state.pedidos = []
  state.tenants = {
    "tenant-a": { id: "tenant-a", name: "Tienda A", subtitle: "Iluminación", logoPath: "/logos/a.svg", shopUrl: "https://tienda.cliente.example/" },
    "tenant-b": { id: "tenant-b", name: "Tienda B", subtitle: "", logoPath: "/logos/b.svg", shopUrl: "" },
  }
  vi.stubEnv("NEXT_PUBLIC_SHOP_URL", "")
  vi.stubEnv("SHOP_TENANT_LEGACY", "otro")
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("GET /api/admin/etiquetas/contexto", () => {
  it("sin sesión → 401 sin datos", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET } = await import("./route")
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(state.pedidos).toEqual([])
  })

  it("operador → 404 uniforme", async () => {
    state.guarded = admin("tenant-a", "operator")
    const { GET } = await import("./route")
    const res = await GET(req())
    expect(res.status).toBe(404)
    expect(state.pedidos).toEqual([])
  })

  it("admin → 200 con los datos de SU tenant y la URL pública del Shop sin barra final", async () => {
    const { GET } = await import("./route")
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(await res.json()).toEqual({
      tenant: { nombre: "Tienda A", rubro: "Iluminación", logoPath: "/logos/a.svg", shopUrl: "https://tienda.cliente.example" },
      sucursales: [{ slug: "igz", nombre: "Iguazú", direccion: "Calle 1", ciudad: "Iguazú", whatsapp: "5491100000000", activa: true }],
      marcas: [{ clave: "acme", nombre: "ACME" }],
    })
    expect(state.pedidos.every((p) => p.endsWith(":tenant-a"))).toBe(true)
  })

  it("otro tenant sin URL de Shop → shopUrl null y sólo sus datos", async () => {
    state.guarded = admin("tenant-b", "superadmin")
    const { GET } = await import("./route")
    const body = await (await GET(req())).json()
    expect(body.tenant.shopUrl).toBeNull()
    expect(body.sucursales).toEqual([])
    expect(body.marcas).toEqual([])
    expect(state.pedidos.every((p) => p.endsWith(":tenant-b"))).toBe(true)
  })
})
