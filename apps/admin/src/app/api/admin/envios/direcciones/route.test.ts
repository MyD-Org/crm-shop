import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * /api/admin/envios/direcciones: proxy de Nominatim para la "Prueba de dirección". Guard (401/403),
 * rate limit (429), búsqueda acotada con un reintento, SIN firmar token (el admin no confía en el
 * punto: sólo lo dibuja) y User-Agent identificable.
 */

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } } as Record<string, unknown>,
  permitido: true,
  claves: [] as string[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/rate-limit", () => ({
  permitirAsync: async (clave: string) => {
    state.claves.push(clave)
    return state.permitido
  },
}))

const fetchMock = vi.fn()

const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status })
const ENCONTRADA = [{ lat: "-38.0016", lon: "-57.5522", address: { road: "Avenida Colón", house_number: "2500", city: "Ciudad Ejemplo", state: "Buenos Aires", postcode: "7600" } }]
const req = (qs: string) => new Request(`http://admin.test/api/admin/envios/direcciones?${qs}`)

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } }
  state.permitido = true
  state.claves = []
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe("GET /api/admin/envios/direcciones", () => {
  it("sin sesión → 401 y sin salir a la red", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    expect((await GET(req("q=Colon%202500"))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rol desconocido → 403", async () => {
    state.guarded = { ok: true, tenantId: "t", user: { id: "u", name: "X", email: "x@cliente.example", role: "visitante" } }
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    expect((await GET(req("q=Colon%202500"))).status).toBe(403)
  })

  it("texto de menos de 4 caracteres → lista vacía sin salir a la red", async () => {
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    const res = await GET(req("q=ab"))
    expect(await res.json()).toEqual({ direcciones: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rate limit por tenant y usuario → 429", async () => {
    state.permitido = false
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    const res = await GET(req("q=Colon%202500"))
    expect(res.status).toBe(429)
    expect(state.claves[0]).toContain("tenant-a")
    expect(state.claves[0]).toContain("u1")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("devuelve coordenadas y precisión, sin ningún token", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(ENCONTRADA))
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    const res = await GET(req("q=Av.%20Col%C3%B3n%202500&ciudad=Ciudad%20Ejemplo&provincia=Buenos%20Aires"))
    const j = await res.json()
    expect(j.direcciones).toHaveLength(1)
    expect(j.direcciones[0]).toMatchObject({ lat: -38.0016, lon: -57.5522, precision: "altura" })
    expect(JSON.stringify(j)).not.toMatch(/token/i)
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url as string).searchParams.get("street")).toBe("2500 av. colón")
    expect((init as RequestInit).headers).toMatchObject({ "User-Agent": expect.stringContaining("crm") })
  })

  it("0 resultados con ciudad → UN reintento por q y, si sigue vacío, lista vacía (sin búsqueda nacional)", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([])).mockResolvedValueOnce(respuesta([]))
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    const res = await GET(req("q=Colon%202500&ciudad=Ciudad%20Ejemplo&provincia=Buenos%20Aires"))
    expect((await res.json()).direcciones).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("q")).toContain("ciudad ejemplo")
  })

  it("el reintento no sale si la primera consulta encontró algo", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(ENCONTRADA))
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    await GET(req("q=Colon%202500&ciudad=Ciudad%20Ejemplo&provincia=Buenos%20Aires"))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("Nominatim caído → 502 en usted", async () => {
    fetchMock.mockRejectedValueOnce(new Error("sin red"))
    const { GET } = await import("@/app/api/admin/envios/direcciones/route")
    const res = await GET(req("q=Colon%202500&ciudad=Ciudad%20Ejemplo"))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Inténtelo/)
  })
})
