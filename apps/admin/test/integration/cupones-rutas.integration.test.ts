import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { hashToken } from "@/lib/admin-crypto"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Rutas /api/admin/cupones/* (spec 2026-11-01-cupones-design.md). DB real, guard real (rol y
// tenant salen de la FILA de admin_users). Los canjes son del Shop: `contarCanjes` se simula acá
// (el test con canjes reales es cupones-canjes-crm). Datos inventados.

let session: Record<string, unknown>
let canjes = 0

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/cupones-canjes", async (orig) => ({
  ...(await orig<typeof import("@/lib/cupones-canjes")>()),
  contarCanjes: async () => canjes,
}))

const lista = await import("@/app/api/admin/cupones/route")
const una = await import("@/app/api/admin/cupones/[id]/route")
const lote = await import("@/app/api/admin/cupones/[id]/lote/route")
const token = await import("@/app/api/admin/cupones/[id]/token/route")

const A = "tenant-a"
const NOT_FOUND = { error: "No encontrado", code: "not_found" }

function login(userId: string, tenantId = A) {
  session = { mfa: "ok", userId, role: "admin", tenantId, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
}

const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://${A}.localhost${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${A}.localhost` },
  })
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

let adminA: string
let operador: string

beforeEach(async () => {
  canjes = 0
  await truncateAll()
  await seedTenant(A)
  adminA = await seedOperator(A, { role: "admin", email: "a@example.com" })
  operador = await seedOperator(A, { role: "operator", email: "op@example.com" })
  login(adminA)
  await getDb().execute(sql`
    INSERT INTO medios_pago_shop (tenant_id, slug, nombre, audiencia)
    VALUES (${A}, 'transferencia', 'Transferencia', 'publico'), (${A}, 'cuenta-corriente', 'Cuenta corriente', 'cuenta_corriente')`)
})
afterAll(async () => {
  await truncateAll()
})

const generica = (extra: Record<string, unknown> = {}) => ({
  nombre: "Apertura",
  tipo: "generica",
  codigo: "apertura10",
  pct: 10,
  envioGratis: false,
  inicio: "2026-11-01T00:00:00-03:00",
  fin: "2030-01-01T00:00:00-03:00",
  soloPrimeraCompra: false,
  condiciones: "No acumula con otras promociones.",
  ...extra,
})
const unicos = (extra: Record<string, unknown> = {}) => ({
  ...generica({ nombre: "Bot Instagram", tipo: "unicos", codigo: undefined, prefijo: "LUZ", venceDiasDesdeEmision: 7 }),
  ...extra,
})

async function crear(body: Record<string, unknown>): Promise<string> {
  const res = await lista.POST(req("/api/admin/cupones", { body }))
  expect(res.status).toBe(201)
  return (await json(res)).id
}

async function historial(id: string) {
  return (await getDb().execute(
    sql`SELECT tipo, objeto FROM precios_online_cambios WHERE tenant_id = ${A} AND objeto = ${"cupon:" + id}`,
  )) as unknown as { tipo: string; objeto: string }[]
}

describe("/api/admin/cupones", () => {
  it("operator: 404 sin datos (guard admin+)", async () => {
    login(operador)
    const res = await lista.GET(req("/api/admin/cupones"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(NOT_FOUND)
  })

  it("POST genérica: 201, código manual normalizado, listado y detalle", async () => {
    const id = await crear(generica())
    const [c] = (await getDb().execute(
      sql`SELECT codigo, origen FROM cupon_codigos WHERE promocion_id = ${id}`,
    )) as unknown as { codigo: string; origen: string }[]
    expect(c).toEqual({ codigo: "APERTURA10", origen: "manual" })
    const l = await json(await lista.GET(req("/api/admin/cupones")))
    expect(l.promociones).toEqual([
      expect.objectContaining({ id, nombre: "Apertura", estado: "activa", codigo: "APERTURA10", codigosEmitidos: 1, canjesUsados: 0, tieneToken: false }),
    ])
    const d = await json(await una.GET(req(`/api/admin/cupones/${id}`), ctx(id)))
    expect(d.promocion).toMatchObject({ id, pct: 10, condiciones: "No acumula con otras promociones." })
    expect(await historial(id)).toEqual([{ tipo: "cupon", objeto: `cupon:${id}` }])
  })

  it("genérica con código repetido en el tenant: 409 codigo_repetido", async () => {
    await crear(generica())
    const res = await lista.POST(req("/api/admin/cupones", { body: generica({ nombre: "Otra", codigo: "APERTURA-10" }) }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "codigo_repetido", error: "Ya existe un cupón con ese código." })
  })

  it("inválida: 400 con la lista de errores", async () => {
    const res = await lista.POST(req("/api/admin/cupones", { body: generica({ pct: 80 }) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "invalid", error: "El descuento debe ser un número entero entre 1 y 50." })
  })

  it("medios: el de cuenta corriente 422; a_coordinar y transferencia se aceptan", async () => {
    const res = await lista.POST(req("/api/admin/cupones", { body: generica({ medios: ["cuenta-corriente"] }) }))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "medio_no_admitido" })
    const res2 = await lista.POST(req("/api/admin/cupones", { body: generica({ medios: ["inexistente"] }) }))
    expect(res2.status).toBe(422)
    const id = await crear(generica({ medios: ["transferencia", "a_coordinar"] }))
    const d = await json(await una.GET(req(`/api/admin/cupones/${id}`), ctx(id)))
    expect(d.promocion.medios).toEqual(["transferencia", "a_coordinar"])
  })

  it("lote: CSV de códigos únicos; tope 500; sólo únicos", async () => {
    const id = await crear(unicos())
    const res = await lote.POST(req(`/api/admin/cupones/${id}/lote`, { body: { cantidad: 3 } }), ctx(id))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/)
    const filas = (await res.text()).trim().split("\n")
    expect(filas[0]).toBe("codigo")
    expect(filas.slice(1)).toHaveLength(3)
    for (const f of filas.slice(1)) expect(f).toMatch(/^LUZ-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
    const [{ n, vence }] = (await getDb().execute(
      sql`SELECT count(*)::int AS n, bool_and(vence_en IS NOT NULL AND origen = 'lote') AS vence FROM cupon_codigos WHERE promocion_id = ${id}`,
    )) as unknown as { n: number; vence: boolean }[]
    expect([n, vence]).toEqual([3, true])

    const mucho = await lote.POST(req(`/api/admin/cupones/${id}/lote`, { body: { cantidad: 501 } }), ctx(id))
    expect(mucho.status).toBe(400)
    const gen = await crear(generica())
    const res3 = await lote.POST(req(`/api/admin/cupones/${gen}/lote`, { body: { cantidad: 3 } }), ctx(gen))
    expect(res3.status).toBe(422)
    expect(await res3.json()).toMatchObject({ code: "solo_unicos" })
  })

  it("token: se muestra una vez, se guarda el hash, se reemplaza y se revoca", async () => {
    const id = await crear(unicos())
    const leerHash = async () =>
      ((await getDb().execute(sql`SELECT token_hash FROM cupon_promociones WHERE id = ${id}`)) as unknown as { token_hash: string | null }[])[0].token_hash
    const r1 = await json(await token.POST(req(`/api/admin/cupones/${id}/token`, { method: "POST" }), ctx(id)))
    expect(r1.token).toMatch(/^[0-9a-f]{64}$/)
    expect(await leerHash()).toBe(hashToken(r1.token))
    const r2 = await json(await token.POST(req(`/api/admin/cupones/${id}/token`, { method: "POST" }), ctx(id)))
    expect(await leerHash()).toBe(hashToken(r2.token))
    expect(r2.token).not.toBe(r1.token)
    const d = await json(await una.GET(req(`/api/admin/cupones/${id}`), ctx(id)))
    expect(d.promocion.tieneToken).toBe(true)
    expect(JSON.stringify(d)).not.toContain(hashToken(r2.token))
    const del = await token.DELETE(req(`/api/admin/cupones/${id}/token`, { method: "DELETE" }), ctx(id))
    expect(del.status).toBe(204)
    expect(await leerHash()).toBeNull()
  })

  it("PUT: con canjes no cambia tipo ni pct; sí fin, límite y condiciones", async () => {
    const id = await crear(generica())
    canjes = 1
    const res = await una.PUT(req(`/api/admin/cupones/${id}`, { method: "PUT", body: generica({ pct: 15 }) }), ctx(id))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "promocion_con_canjes" })
    const ok = await una.PUT(
      req(`/api/admin/cupones/${id}`, { method: "PUT", body: generica({ fin: "2031-01-01T00:00:00-03:00", limiteCanjes: 100, condiciones: "Nuevas" }) }),
      ctx(id),
    )
    expect(ok.status).toBe(200)
    const d = await json(await una.GET(req(`/api/admin/cupones/${id}`), ctx(id)))
    expect(d.promocion).toMatchObject({ limiteCanjes: 100, condiciones: "Nuevas" })
    expect(await historial(id)).toHaveLength(2)
  })

  it("PUT sin canjes cambia el código de la genérica", async () => {
    const id = await crear(generica())
    const ok = await una.PUT(req(`/api/admin/cupones/${id}`, { method: "PUT", body: generica({ codigo: "OTRO2026", pct: 20 }) }), ctx(id))
    expect(ok.status).toBe(200)
    const l = await json(await lista.GET(req("/api/admin/cupones")))
    expect(l.promociones[0]).toMatchObject({ codigo: "OTRO2026", pct: 20, codigosEmitidos: 1 })
  })

  it("PATCH pausa y reanuda", async () => {
    const id = await crear(generica())
    const res = await una.PATCH(req(`/api/admin/cupones/${id}`, { method: "PATCH", body: { activa: false } }), ctx(id))
    expect(res.status).toBe(200)
    const d = await json(await una.GET(req(`/api/admin/cupones/${id}`), ctx(id)))
    expect(d.promocion).toMatchObject({ activa: false, estado: "pausada" })
    const mal = await una.PATCH(req(`/api/admin/cupones/${id}`, { method: "PATCH", body: { activa: "no" } }), ctx(id))
    expect(mal.status).toBe(400)
  })

  it("DELETE: con canjes 409; sin canjes 204 y borra los códigos", async () => {
    const id = await crear(unicos())
    await lote.POST(req(`/api/admin/cupones/${id}/lote`, { body: { cantidad: 2 } }), ctx(id))
    canjes = 1
    expect((await una.DELETE(req(`/api/admin/cupones/${id}`, { method: "DELETE" }), ctx(id))).status).toBe(409)
    canjes = 0
    expect((await una.DELETE(req(`/api/admin/cupones/${id}`, { method: "DELETE" }), ctx(id))).status).toBe(204)
    const [{ n }] = (await getDb().execute(
      sql`SELECT count(*)::int AS n FROM cupon_codigos WHERE promocion_id = ${id}`,
    )) as unknown as { n: number }[]
    expect(n).toBe(0)
    expect((await una.GET(req(`/api/admin/cupones/${id}`), ctx(id))).status).toBe(404)
  })

  it("id de otro tenant o inválido: 404", async () => {
    expect((await una.GET(req("/api/admin/cupones/no-uuid"), ctx("no-uuid"))).status).toBe(404)
    const otro = "00000000-0000-4000-8000-000000000000"
    expect((await una.GET(req(`/api/admin/cupones/${otro}`), ctx(otro))).status).toBe(404)
  })
})
