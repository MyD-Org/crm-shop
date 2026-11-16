import { beforeEach, describe, expect, it, vi } from "vitest"
import { ErrorCompras } from "@/lib/compras-dinero"

/**
 * Rutas de /api/admin/compras: guard (rol + flag), validación y mapeo de errores. El guard de
 * sesión, el flag y el servicio se simulan (el servicio real se cubre en
 * test/integration/compras-service.integration.test.ts): lo central acá es que con el flag apagado
 * o sin el rol correcto NO se llega al servicio, o sea que no se toca Alegra.
 */

const state = vi.hoisted(() => ({
  guarded: {} as Record<string, unknown>,
  flag: true,
  flagRecepcion: true,
  llamadas: [] as string[],
  resultado: null as unknown,
  error: null as unknown,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/compras-flag", () => ({
  comprasHabilitado: async () => state.flag,
  comprasRecepcionHabilitada: async () => state.flag && state.flagRecepcion,
}))
vi.mock("@/lib/compras-service", () => {
  const llamar = (nombre: string) => async () => {
    state.llamadas.push(nombre)
    if (state.error) throw state.error
    return state.resultado
  }
  return {
    crearCompraDesdeBody: llamar("crear"),
    editarCompraDesdeBody: llamar("editar"),
    anularCompra: llamar("anular"),
    detalleCompra: llamar("detalle"),
  }
})
vi.mock("@/lib/compras-repo", () => ({ listarCompras: async () => [] }))
vi.mock("@/lib/compras-config-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compras-config-repo")>()),
  cuentaActivaPorSlug: async () => ({ id: "c1", slug: "mdp", nombre: "MDP", principal: false }),
  guardarConfigCompras: async () => ({ categoriaTransitoId: null, percepciones: {}, almacenId: null }),
}))

const usuario = (role: string) => ({ ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role } })
const ID = "11111111-1111-4111-8111-111111111111"
const post = (body: unknown = { cuenta: "mdp" }) =>
  new Request("http://admin.test/api/admin/compras", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  state.guarded = usuario("compras")
  state.flag = true
  state.flagRecepcion = true
  state.llamadas = []
  state.resultado = { compraId: ID, estado: "pendiente", incierta: false }
  state.error = null
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("guard de /api/admin/compras", () => {
  it("sin sesión → 401", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const { POST, GET } = await import("./route")
    expect((await POST(post())).status).toBe(401)
    expect((await GET(post())).status).toBe(401)
    expect(state.llamadas).toEqual([])
  })

  it("operador → 404 y no llega al servicio", async () => {
    state.guarded = usuario("operator")
    const { POST } = await import("./route")
    expect((await POST(post())).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })

  it.each(["compras", "admin", "superadmin"])("el rol %s crea la compra (201)", async (rol) => {
    state.guarded = usuario(rol)
    const { POST } = await import("./route")
    const res = await POST(post())
    expect(res.status).toBe(201)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(state.llamadas).toEqual(["crear"])
  })

  it("flag apagado → 404 y no llega al servicio (no se toca Alegra)", async () => {
    state.flag = false
    const { POST, GET } = await import("./route")
    expect((await POST(post())).status).toBe(404)
    expect((await GET(post())).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })

  it("una creación incierta responde 202", async () => {
    state.resultado = { compraId: ID, estado: "creando", incierta: true, aviso: "x" }
    const { POST } = await import("./route")
    expect((await POST(post())).status).toBe(202)
  })

  it("los errores de dominio salen como {error, code} con su status", async () => {
    const { POST } = await import("./route")
    state.error = new ErrorCompras("validacion", "Agregue al menos un producto a la compra.")
    const r1 = await POST(post())
    expect(r1.status).toBe(400)
    expect(await r1.json()).toEqual({ error: "Agregue al menos un producto a la compra.", code: "validacion" })
    state.error = new ErrorCompras("numero_duplicado", "Ya existe una compra de este proveedor.")
    expect((await POST(post())).status).toBe(409)
    state.error = new Error("boom con datos internos")
    const r3 = await POST(post())
    expect(r3.status).toBe(500)
    expect(JSON.stringify(await r3.json())).not.toContain("boom")
  })
})

describe("/api/admin/compras/[id]", () => {
  it("un id mal formado → 404 sin llegar al servicio", async () => {
    const { GET, DELETE } = await import("./[id]/route")
    expect((await GET(post(), params("no-es-uuid"))).status).toBe(404)
    expect((await DELETE(post(), params("no-es-uuid"))).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })

  it("una compra inexistente o de otro tenant → 404", async () => {
    state.resultado = null
    const { GET } = await import("./[id]/route")
    expect((await GET(post(), params(ID))).status).toBe(404)
  })

  it("anular con flag apagado → 404; con flag prendido llama al servicio", async () => {
    const { DELETE } = await import("./[id]/route")
    state.flag = false
    expect((await DELETE(post(), params(ID))).status).toBe(404)
    expect(state.llamadas).toEqual([])
    state.flag = true
    expect((await DELETE(post(), params(ID))).status).toBe(200)
    expect(state.llamadas).toEqual(["anular"])
  })

  it("editar exige además compras-recepcion", async () => {
    const { PATCH } = await import("./[id]/route")
    state.flagRecepcion = false
    expect((await PATCH(post({ items: [] }), params(ID))).status).toBe(404)
    expect(state.llamadas).toEqual([])
    state.flagRecepcion = true
    expect((await PATCH(post({ items: [] }), params(ID))).status).toBe(200)
  })

  it("una compra con mercadería recibida responde 409 con el aviso en usted", async () => {
    state.error = new ErrorCompras("no_modificable", "La compra ya tiene mercadería recibida y no puede modificarse ni anularse.")
    const { DELETE } = await import("./[id]/route")
    const res = await DELETE(post(), params(ID))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("ya tiene mercadería recibida")
  })
})

describe("/api/admin/compras/config", () => {
  const put = () =>
    new Request("http://admin.test/api/admin/compras/config?cuenta=mdp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ almacenId: "wh1" }),
    })

  it("el rol compras no puede modificar la configuración (403)", async () => {
    const { PUT } = await import("./config/route")
    const res = await PUT(put())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain("Su rol")
  })

  it("un admin la modifica; un percepcion con id inválido → 400", async () => {
    state.guarded = usuario("admin")
    const { PUT } = await import("./config/route")
    expect((await PUT(put())).status).toBe(200)
    const mala = new Request("http://admin.test/api/admin/compras/config?cuenta=mdp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ percepciones: { "IIBB Bs As": "no-es-uuid" } }),
    })
    expect((await PUT(mala)).status).toBe(400)
  })
})
