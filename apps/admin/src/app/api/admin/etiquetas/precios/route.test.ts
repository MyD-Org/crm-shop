import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/admin/etiquetas/precios: guard de la sección (401 sin sesión, 404 sin la sección),
 * tenant del guard para elegir el Shop y su secreto, ids validados y la respuesta del Shop filtrada.
 * El fetch al Shop se simula; el endpoint del Shop tiene su propio test en apps/clientes.
 */

const state = vi.hoisted(() => ({
  guarded: {} as Record<string, unknown>,
  filas: {} as Record<string, { shopUrl: string; shopInternalUrl: string }>,
  leidas: [] as string[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/shop-destino-db", () => ({
  leerFilaShop: async (id: string) => {
    state.leidas.push(id)
    return state.filas[id] ?? { shopUrl: "", shopInternalUrl: "" }
  },
}))

const fetchMock = vi.fn()

const req = (body: unknown) =>
  new Request("http://admin.test/api/admin/etiquetas/precios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
const admin = (tenantId: string, role = "admin") => ({
  ok: true,
  tenantId,
  user: { id: "u1", name: "Ana", email: "ana@cliente.example", role, canalesPermitidos: null },
})
const respuestaShop = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
  state.guarded = admin("tenant-a")
  state.leidas = []
  state.filas = {
    "tenant-a": { shopUrl: "https://tienda.cliente.example", shopInternalUrl: "" },
    "tenant-b": { shopUrl: "https://otra.cliente.example", shopInternalUrl: "" },
  }
  vi.stubEnv("SHOP_CRM_SECRET_TENANT_A", "secreto-a")
  vi.stubEnv("SHOP_CRM_SECRET_TENANT_B", "")
  vi.stubEnv("SHOP_TENANT_LEGACY", "otro")
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("POST /api/admin/etiquetas/precios", () => {
  it("sin sesión → 401 y no pide nada al Shop", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { POST } = await import("./route")
    expect((await POST(req({ ids: ["1"] }))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("operador sin la sección → 404 uniforme", async () => {
    state.guarded = admin("tenant-a", "operator")
    const { POST } = await import("./route")
    expect((await POST(req({ ids: ["1"] }))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("body inválido o demasiados ids → 400 con mensaje en usted", async () => {
    const { POST } = await import("./route")
    expect((await POST(req("x"))).status).toBe(400)
    const res = await POST(req({ ids: Array.from({ length: 1001 }, (_, i) => String(i)) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Indique hasta 1000 productos.")
  })

  it("pide al Shop de SU tenant con su secreto, sólo ids válidos, y devuelve los precios validados", async () => {
    fetchMock.mockResolvedValue(
      respuestaShop({
        precios: {
          "1": { precioLista: 45900, precioMedio: { nombre: "Transferencia", rotulo: "con Transferencia", precio: 41310 } },
          "mdp:2": { precioLista: 1000, precioMedio: null },
          "3": { precioLista: "mal", precioMedio: { precio: "x" } },
          ajeno: { precioLista: 1, precioMedio: null },
        },
      }),
    )
    const { POST } = await import("./route")
    const res = await POST(req({ ids: ["1", "1", "mdp:2", "3", "../x", 7] }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(state.leidas).toEqual(["tenant-a"])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://tienda.cliente.example/api/internal/etiquetas/precios")
    expect(init.method).toBe("POST")
    expect(init.headers.authorization).toBe("Bearer secreto-a")
    expect(JSON.parse(init.body)).toEqual({ ids: ["1", "mdp:2", "3"] })
    expect(await res.json()).toEqual({
      precios: {
        "1": { precioLista: 45900, precioMedio: { nombre: "Transferencia", rotulo: "con Transferencia", precio: 41310 } },
        "mdp:2": { precioLista: 1000, precioMedio: null },
        "3": { precioLista: null, precioMedio: null },
      },
    })
  })

  it("tenant con Shop propio pero sin su secreto → 409 y no manda el secreto de otro", async () => {
    state.guarded = admin("tenant-b")
    const { POST } = await import("./route")
    const res = await POST(req({ ids: ["1"] }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/no se pueden obtener los precios/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("el Shop falla o contesta otra cosa (cortina HTML) → 502", async () => {
    const { POST } = await import("./route")
    fetchMock.mockResolvedValueOnce(respuestaShop({ error: "x" }, 500))
    expect((await POST(req({ ids: ["1"] }))).status).toBe(502)
    fetchMock.mockResolvedValueOnce(new Response("<html>Próximamente</html>", { status: 200 }))
    const res = await POST(req({ ids: ["1"] }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe("No se pudieron obtener los precios de la tienda web. Inténtelo nuevamente.")
    fetchMock.mockRejectedValueOnce(new Error("red"))
    expect((await POST(req({ ids: ["1"] }))).status).toBe(502)
  })
})
