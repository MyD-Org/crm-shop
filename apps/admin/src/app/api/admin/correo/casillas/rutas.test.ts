import { beforeEach, describe, expect, it, vi } from "vitest"

// Rutas de administración de casillas (admin+). Corre el guard real sobre una sesión simulada;
// repo, flag y Resend se mockean (el SQL real lo cubre test/integration).

const state = vi.hoisted(() => ({
  sesion: { ok: true, tenantId: "t1", user: { id: "u1", name: "Admin", email: "a@cliente.example", role: "admin", availability: "away" } } as
    | { ok: false; reason: string }
    | { ok: true; tenantId: string; user: { id: string; name: string; email: string; role: string; availability: string } },
  flag: true,
  inboxes: [] as { id: string; email: string; nombre: string }[],
  resendFalla: null as null | Error,
}))
const repo = vi.hoisted(() => ({
  listarCasillas: vi.fn(),
  upsertCasilla: vi.fn(),
  actualizarCasilla: vi.fn(),
  usuariosParaAcceso: vi.fn(),
  accesosDelTenant: vi.fn(),
  reemplazarAccesos: vi.fn(),
  casillaDelTenant: vi.fn(),
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.sesion }))
vi.mock("@/lib/correo-flag", () => ({ correoHabilitado: async () => state.flag }))
vi.mock("@/lib/correo-repo", () => repo)
vi.mock("@/lib/correo-resend", async (orig) => {
  const real = await orig<typeof import("@/lib/correo-resend")>()
  return {
    ...real,
    listInboxes: vi.fn(async () => {
      if (state.resendFalla) throw state.resendFalla
      return state.inboxes
    }),
  }
})

import { CorreoResendError } from "@/lib/correo-resend"
import { GET as listar } from "./route"
import { POST as sincronizar } from "./sincronizar/route"
import { PATCH as editar } from "./[id]/route"
import { GET as getAccesos, PUT as putAccesos } from "./[id]/accesos/route"

const ID = "11111111-1111-4111-8111-111111111111"
const casillaRow = { id: ID, tenantId: "t1", resendInboxId: "inbox_1", email: "ventas@cliente.example", nombre: "Ventas", activa: true, orden: 0 }
const req = (body?: unknown, method = "GET") =>
  new Request("https://admin.plataforma.example/api/admin/correo/casillas", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })

const TODAS: [string, () => Promise<Response>][] = [
  ["GET casillas", () => listar(req())],
  ["POST sincronizar", () => sincronizar(req(undefined, "POST"))],
  ["PATCH casilla", () => editar(req({ nombre: "x" }, "PATCH"), ctx())],
  ["GET accesos", () => getAccesos(req(), ctx())],
  ["PUT accesos", () => putAccesos(req({ admin_user_ids: [] }, "PUT"), ctx())],
]

beforeEach(() => {
  vi.clearAllMocks()
  state.sesion = { ok: true, tenantId: "t1", user: { id: "u1", name: "Admin", email: "a@cliente.example", role: "admin", availability: "away" } }
  state.flag = true
  state.inboxes = []
  state.resendFalla = null
  repo.listarCasillas.mockResolvedValue([casillaRow])
  repo.usuariosParaAcceso.mockResolvedValue([{ id: "op1", name: "Ana", email: "ana@cliente.example" }])
  repo.accesosDelTenant.mockResolvedValue([{ casillaId: ID, adminUserId: "op1" }])
  repo.casillaDelTenant.mockResolvedValue(casillaRow)
  repo.upsertCasilla.mockResolvedValue(casillaRow)
  repo.actualizarCasilla.mockResolvedValue({ ...casillaRow, nombre: "Ventas Sur" })
  repo.reemplazarAccesos.mockResolvedValue({ ok: true })
})

describe.each(TODAS)("%s: guard", (_n, llamar) => {
  it("sin sesión: 401", async () => {
    state.sesion = { ok: false, reason: "no-session" }
    expect((await llamar()).status).toBe(401)
  })
  it("operador: 404 (sin oráculo)", async () => {
    if (state.sesion.ok) state.sesion.user.role = "operator"
    const r = await llamar()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "No encontrado", code: "not_found" })
  })
  it("flag apagado: 404 y no toca repo ni Resend", async () => {
    state.flag = false
    expect((await llamar()).status).toBe(404)
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled()
  })
})

describe("GET casillas", () => {
  it("devuelve casillas con sus accesos y los operadores tildables", async () => {
    const r = await listar(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.casillas).toEqual([
      { id: ID, email: "ventas@cliente.example", nombre: "Ventas", activa: true, orden: 0, adminUserIds: ["op1"] },
    ])
    expect(j.usuarios).toEqual([{ id: "op1", name: "Ana", email: "ana@cliente.example" }])
    expect(repo.listarCasillas).toHaveBeenCalledWith("t1")
    expect(JSON.stringify(j)).not.toContain("resendInboxId")
  })
})

describe("POST sincronizar", () => {
  it("da de alta las inboxes nuevas INACTIVAS y devuelve la vista; no pisa lo existente", async () => {
    state.inboxes = [{ id: "inbox_1", email: "ventas@cliente.example", nombre: "ventas" }]
    const r = await sincronizar(req(undefined, "POST"))
    expect(r.status).toBe(200)
    expect(repo.upsertCasilla).toHaveBeenCalledWith("t1", { resendInboxId: "inbox_1", email: "ventas@cliente.example", nombre: "ventas", activa: false })
    expect((await r.json()).casillas).toHaveLength(1)
  })

  it("Resend caído: error en usted sin cuerpo crudo", async () => {
    state.resendFalla = new CorreoResendError("servidor", 502)
    const r = await sincronizar(req(undefined, "POST"))
    expect(r.status).toBe(502)
    const j = await r.json()
    expect(j.error).toMatch(/Inténtelo/)
    expect(repo.upsertCasilla).not.toHaveBeenCalled()
  })

  it("sin configurar: 503", async () => {
    state.resendFalla = new CorreoResendError("no_configurado")
    expect((await sincronizar(req(undefined, "POST"))).status).toBe(503)
  })
})

describe("PATCH casilla", () => {
  it("edita nombre y activa", async () => {
    const r = await editar(req({ nombre: "  Ventas Sur  ", activa: false }, "PATCH"), ctx())
    expect(r.status).toBe(200)
    expect(repo.actualizarCasilla).toHaveBeenCalledWith("t1", ID, { nombre: "Ventas Sur", activa: false })
  })
  it("nombre vacío o tipos inválidos: 400 en usted", async () => {
    for (const body of [{ nombre: "  " }, { activa: "si" }, {}, { nombre: "x".repeat(200) }]) {
      const r = await editar(req(body, "PATCH"), ctx())
      expect(r.status).toBe(400)
    }
    expect(repo.actualizarCasilla).not.toHaveBeenCalled()
  })
  it("casilla ajena o inexistente: 404 y uuid inválido también", async () => {
    repo.actualizarCasilla.mockResolvedValue(null)
    expect((await editar(req({ nombre: "x" }, "PATCH"), ctx())).status).toBe(404)
    expect((await editar(req({ nombre: "x" }, "PATCH"), ctx("no-uuid"))).status).toBe(404)
  })
})

describe("accesos", () => {
  it("GET devuelve los ids con acceso", async () => {
    const r = await getAccesos(req(), ctx())
    expect(await r.json()).toEqual({ adminUserIds: ["op1"] })
  })
  it("PUT reemplaza y devuelve la lista", async () => {
    const r = await putAccesos(req({ admin_user_ids: ["op1", "op2"] }, "PUT"), ctx())
    expect(r.status).toBe(200)
    expect(repo.reemplazarAccesos).toHaveBeenCalledWith("t1", ID, ["op1", "op2"])
  })
  it("PUT con ids de otro tenant: 400 y mensaje en usted", async () => {
    repo.reemplazarAccesos.mockResolvedValue({ ok: false, invalidos: ["x"] })
    const r = await putAccesos(req({ admin_user_ids: ["x"] }, "PUT"), ctx())
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/usuarios/)
  })
  it("PUT con casilla ajena: 404", async () => {
    repo.reemplazarAccesos.mockResolvedValue({ ok: false, invalidos: [] })
    expect((await putAccesos(req({ admin_user_ids: [] }, "PUT"), ctx())).status).toBe(404)
  })
  it("PUT con body inválido: 400 sin escribir", async () => {
    for (const body of [{}, { admin_user_ids: "op1" }, { admin_user_ids: [1] }, null]) {
      expect((await putAccesos(req(body, "PUT"), ctx())).status).toBe(400)
    }
    expect(repo.reemplazarAccesos).not.toHaveBeenCalled()
  })
})
