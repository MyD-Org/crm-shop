import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /api/admin/settings/tienda-online: guard, validación en usted, UPDATE sólo del tenant del guard
 * y ping de marca al Shop de ESE tenant después de guardar.
 */

const state = vi.hoisted(() => ({
  session: { userId: "u1", role: "admin", tenantId: "tenant-a" } as Record<string, unknown>,
  fila: [] as unknown[],
  updates: [] as { set: Record<string, unknown>; where: unknown }[],
  pings: [] as string[],
  ping: { propagado: true } as { propagado: boolean },
  pingTira: false,
}))

vi.mock("@/lib/admin-route-guard", () => ({
  requireAdminPlus: async () => {
    const s = state.session
    if (!s.userId) return { ok: false, response: Response.json({ error: "No autorizado" }, { status: 401 }) }
    if (s.role === "operator") return { ok: false, response: Response.json({ error: "No encontrado" }, { status: 404 }) }
    return { ok: true, tenantId: s.tenantId }
  },
}))
vi.mock("drizzle-orm", async () => {
  const real = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm")
  return { ...real, eq: (_col: unknown, valor: unknown) => ({ eq: valor }) }
})
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(state.fila) }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          state.updates.push({ set, where })
          return Promise.resolve()
        },
      }),
    }),
  }),
}))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarMarca: async (tenantId: string) => {
    state.pings.push(tenantId)
    if (state.pingTira) throw new Error("no debería propagarse")
    return state.ping
  },
}))

const COLORES = {
  bg: "#f8f8f6", surface: "#ffffff", text: "#1c2733", muted: "#5f6770",
  primary: "#16283f", onPrimary: "#eaf1f8", accent: "#1e5aa8", surfaceDark: "#1c2733",
}

const req = (method: string, body?: unknown) =>
  new Request("http://admin.test/api/admin/settings/tienda-online", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.session = { userId: "u1", role: "admin", tenantId: "tenant-a" }
  state.fila = []
  state.updates = []
  state.pings = []
  state.ping = { propagado: true }
  state.pingTira = false
  vi.stubEnv("SHOP_MEDIA_HOSTS", "media.example")
  vi.stubEnv("R2_SHOP_MEDIA_PUBLIC_URL", "https://media.example")
})

describe("/api/admin/settings/tienda-online", () => {
  it("sin sesión → 401; operator → 404; no escribe ni avisa", async () => {
    const { GET, PUT } = await import("./route")
    state.session = {}
    expect((await GET(req("GET"))).status).toBe(401)
    state.session = { userId: "u1", role: "operator", tenantId: "tenant-a" }
    expect((await PUT(req("PUT", { marca: { nombre: "X" } }))).status).toBe(404)
    expect(state.updates).toEqual([])
    expect(state.pings).toEqual([])
  })

  it("GET devuelve lo guardado, o los valores vacíos ('{}') si no hay fila", async () => {
    const { GET } = await import("./route")
    const vacio = await (await GET(req("GET"))).json()
    expect(vacio).toMatchObject({ marca: {}, shopUrl: "", shopInternalUrl: "" })
    state.fila = [{ marca: { nombre: "Tienda Uno" }, shopUrl: "https://uno.example", shopInternalUrl: "" }]
    expect(await (await GET(req("GET"))).json()).toMatchObject({
      marca: { nombre: "Tienda Uno" },
      shopUrl: "https://uno.example",
    })
  })

  it("PUT válido guarda limpio sólo en el tenant del guard (ignora tenantId del body) y avisa al Shop de ese tenant", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(
      req("PUT", {
        tenantId: "otro",
        marca: { nombre: " Tienda   Uno ", base: "generica", logoUrl: "https://media.example/marca/tenant-a/x.svg" },
        shopUrl: "https://uno.example/",
        shopInternalUrl: "",
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      marca: { nombre: "Tienda Uno", base: "generica", logoUrl: "https://media.example/marca/tenant-a/x.svg" },
      shopUrl: "https://uno.example",
      shopInternalUrl: "",
      propagado: true,
    })
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].set).toMatchObject({
      shopMarca: { nombre: "Tienda Uno", base: "generica", logoUrl: "https://media.example/marca/tenant-a/x.svg" },
      shopUrl: "https://uno.example",
      shopInternalUrl: "",
    })
    expect(state.updates[0].where).toEqual({ eq: "tenant-a" })
    expect(state.pings).toEqual(["tenant-a"])
  })

  it("guardar sin cambios ('{}' y direcciones vacías) escribe los mismos valores vacíos", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { marca: {}, shopUrl: "", shopInternalUrl: "" }))
    expect(res.status).toBe(200)
    expect(state.updates[0].set).toMatchObject({ shopMarca: {}, shopUrl: "", shopInternalUrl: "" })
  })

  it("Shop sin responder: guarda igual y devuelve propagado:false", async () => {
    const { PUT } = await import("./route")
    state.ping = { propagado: false }
    const res = await PUT(req("PUT", { marca: { nombre: "X" } }))
    expect(res.status).toBe(200)
    expect((await res.json()).propagado).toBe(false)
    expect(state.updates).toHaveLength(1)
  })

  it("PUT inválido → 400 con el error en usted, sin escribir ni avisar", async () => {
    const { PUT } = await import("./route")
    for (const cuerpo of [
      { marca: { descripcion: "d".repeat(201) } },
      { marca: { logoUrl: "https://otro.example/logo.svg" } },
      { shopUrl: "http://uno.example" },
      { shopInternalUrl: "https://uno.example/ruta" },
    ]) {
      const res = await PUT(req("PUT", cuerpo))
      expect(res.status).toBe(400)
      const j = await res.json()
      expect(j.code).toBe("invalid")
      expect(j.error).not.toMatch(/\b(tu|tus|vos)\b/i)
    }
    expect(state.updates).toEqual([])
    expect(state.pings).toEqual([])
  })

  it("rechaza un logo del bucket que está bajo el prefijo de OTRO tenant", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { marca: { logoUrl: "https://media.example/marca/tenant-b/x.svg" } }))
    expect(res.status).toBe(400)
    expect((await res.json()).campo).toBe("logoUrl")
    expect(state.updates).toEqual([])
  })

  it("rechaza un logo del bucket fuera de marca/ (p. ej. una foto de producto)", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { marca: { logoUrl: "https://media.example/productos/tenant-a/1/x.png" } }))
    expect(res.status).toBe(400)
  })

  it("GET devuelve el tema guardado, o '{}' si no hay", async () => {
    const { GET } = await import("./route")
    expect((await (await GET(req("GET"))).json()).tema).toEqual({})
    state.fila = [{ marca: {}, shopUrl: "", shopInternalUrl: "", tema: { base: "calido" } }]
    expect((await (await GET(req("GET"))).json()).tema).toEqual({ base: "calido" })
  })

  it("PUT con paleta legible guarda el tema normalizado sólo en el tenant del guard y avisa al Shop", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { marca: {}, tema: { base: "calido-azul", colores: { ...COLORES, accent: "#1E5AA8" } } }))
    expect(res.status).toBe(200)
    expect((await res.json()).tema).toEqual({ base: "calido-azul", colores: COLORES })
    expect(state.updates[0].set).toMatchObject({ shopTema: { base: "calido-azul", colores: COLORES } })
    expect(state.updates[0].where).toEqual({ eq: "tenant-a" })
    expect(state.pings).toEqual(["tenant-a"])
  })

  it("PUT con paleta de poco contraste → 400 en usted, sin escribir ni avisar", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { tema: { colores: { ...COLORES, text: "#f0f0ee" } } }))
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j).toMatchObject({ code: "invalid", campo: "text" })
    expect(j.error).toMatch(/contraste/i)
    expect(j.error).not.toMatch(/\b(tu|tus|te|vos)\b/i)
    expect(state.updates).toEqual([])
    expect(state.pings).toEqual([])
  })

  it("PUT con color mal formado → 400 con el campo", async () => {
    const { PUT } = await import("./route")
    const res = await PUT(req("PUT", { tema: { colores: { ...COLORES, bg: "azul" } } }))
    expect(res.status).toBe(400)
    expect((await res.json()).campo).toBe("bg")
    expect(state.updates).toEqual([])
  })

  it("tema vacío ({}) restablece el tema de partida; sin la clave tema no se toca", async () => {
    const { PUT } = await import("./route")
    await PUT(req("PUT", { marca: {}, tema: {} }))
    expect(state.updates[0].set).toMatchObject({ shopTema: {} })
    await PUT(req("PUT", { marca: { nombre: "X" } }))
    expect("shopTema" in state.updates[1].set).toBe(false)
  })

  it("solo base (sin colores) no pide contraste", async () => {
    const { PUT } = await import("./route")
    expect((await PUT(req("PUT", { tema: { base: "calido" } }))).status).toBe(200)
  })
})
