import { beforeEach, describe, expect, it, vi } from "vitest"
import { ErrorCompras } from "@/lib/compras-dinero"

// Rutas de alta y copia de productos (S4b): guard (rol + flag) y mapeo de errores. El servicio se
// simula (su lógica se cubre en lib/compras-producto-alta.test.ts): lo central es que sin el rol
// correcto, con el flag apagado o sin confirmar NO se llega a escribir en Alegra.

const state = vi.hoisted(() => ({
  guarded: {} as Record<string, unknown>,
  flag: true,
  llamadas: [] as string[],
  error: null as unknown,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/compras-flag", () => ({ comprasHabilitado: async () => state.flag, comprasRecepcionHabilitada: async () => state.flag }))
vi.mock("@/lib/compras-config-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compras-config-repo")>()),
  cuentaActivaPorSlug: async () => ({ id: "c1", slug: "mdp", nombre: "MDP", principal: false }),
  configAlegraDeCuenta: async () => ({}),
}))
vi.mock("@/lib/compras-producto-alta", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/compras-producto-alta")>()
  const llamar = (n: string) => async () => {
    state.llamadas.push(n)
    if (state.error) throw state.error
    return { alegraId: "mdp:71", itemIdCuenta: "71", yaExistia: false, espejado: true, ajustes: [], ajustesGuardados: 0 }
  }
  return { ...real, crearProductoCompra: llamar("crear"), copiarProductoACuenta: llamar("copiar"), listasParaAlta: async () => [], datosParaCopia: async () => null }
})

const usuario = (role: string) => ({ ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role } })
const cuerpoAlta = {
  cuenta: "mdp",
  nombre: "Lámpara",
  codigoProveedor: "LED9W",
  marca: "Macroled",
  sufijoMarca: "MCL",
  ivaPorcentaje: 21,
  costo: 100,
  precios: [{ id: "1", precio: 160 }],
  confirmar: true,
}
const post = (body: unknown) =>
  new Request("http://admin.test/api/admin/compras/productos/alta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = usuario("compras")
  state.flag = true
  state.llamadas = []
  state.error = null
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("POST /productos/alta", () => {
  it.each(["compras", "admin", "superadmin"])("el rol %s crea (201)", async (rol) => {
    state.guarded = usuario(rol)
    const { POST } = await import("./alta/route")
    expect((await POST(post(cuerpoAlta))).status).toBe(201)
    expect(state.llamadas).toEqual(["crear"])
  })

  it("operador, sin sesión o flag apagado: no llega al servicio", async () => {
    const { POST } = await import("./alta/route")
    state.guarded = usuario("operator")
    expect((await POST(post(cuerpoAlta))).status).toBe(404)
    state.guarded = { ok: false, reason: "no-session" }
    expect((await POST(post(cuerpoAlta))).status).toBe(401)
    state.guarded = usuario("admin")
    state.flag = false
    expect((await POST(post(cuerpoAlta))).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })

  it("valida el cuerpo antes de tocar el servicio (400, en usted)", async () => {
    const { POST } = await import("./alta/route")
    const r = await POST(post({ ...cuerpoAlta, sufijoMarca: "" }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/sufijo/)
    expect(state.llamadas).toEqual([])
  })

  it("sin confirmar el servicio responde 400 confirmacion_requerida", async () => {
    const { POST } = await import("./alta/route")
    state.error = new ErrorCompras("confirmacion_requerida", "Confirme la operación antes de crear el producto en Alegra.")
    expect((await POST(post({ ...cuerpoAlta, confirmar: false }))).status).toBe(400)
  })

  it("producto existente → 409", async () => {
    const { POST } = await import("./alta/route")
    state.error = new ErrorCompras("producto_existente", "Ya existe.")
    expect((await POST(post(cuerpoAlta))).status).toBe(409)
  })
})

describe("POST /productos/copiar", () => {
  const copiar = (body: unknown) =>
    new Request("http://admin.test/api/admin/compras/productos/copiar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

  it("operador → 404; compras → 201", async () => {
    const { POST } = await import("./copiar/route")
    state.guarded = usuario("operator")
    expect((await POST(copiar({ cuenta: "mdp", alegraId: "5", precios: [], confirmar: true }))).status).toBe(404)
    expect(state.llamadas).toEqual([])
    state.guarded = usuario("compras")
    expect((await POST(copiar({ cuenta: "mdp", alegraId: "5", precios: [], confirmar: true }))).status).toBe(201)
    expect(state.llamadas).toEqual(["copiar"])
  })

  it("faltan datos → 400", async () => {
    const { POST } = await import("./copiar/route")
    expect((await POST(copiar({ cuenta: "mdp" }))).status).toBe(400)
  })
})
