import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { seedOperator, seedTenant, truncateAll } from "./helpers"
import { aplicar, seedLista, seedProducto } from "./precios-online-helpers"

// Rutas /api/admin/campanias/* (spec 2026-10-28-campanias-precios-design.md). DB real, guard real
// (rol y tenant salen de la FILA de admin_users). Datos inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const lista = await import("@/app/api/admin/campanias/route")
const una = await import("@/app/api/admin/campanias/[id]/route")
const terminar = await import("@/app/api/admin/campanias/[id]/terminar/route")
const previa = await import("@/app/api/admin/campanias/previsualizar/route")

const A = "tenant-a"
const NOT_FOUND = { error: "No encontrado", code: "not_found" }

function login(userId: string, tenantId = A) {
  session = { userId, role: "admin", tenantId, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
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
  await truncateAll()
  await seedTenant(A)
  adminA = await seedOperator(A, { role: "admin", email: "a@example.com" })
  operador = await seedOperator(A, { role: "operator", email: "op@example.com" })
  login(adminA)
  await seedLista(A, "Tarjeta cuotas", "1.6", { esReferencia: true })
  await seedProducto(A, { alegraId: "1", costo: "100", brand: "acme" })
  await aplicar(A, null, "config")
})
afterAll(async () => {
  await truncateAll()
})

async function ahoraDb(): Promise<Date> {
  const [r] = (await getDb().execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  return new Date(r.n)
}
const horas = (base: Date, h: number) => new Date(base.getTime() + h * 3_600_000).toISOString()

function cuerpo(ahora: Date, extra: Record<string, unknown> = {}) {
  return {
    nombre: "Black Friday",
    inicio: horas(ahora, -1),
    fin: horas(ahora, 24),
    reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 20 }],
    ...extra,
  }
}

describe("/api/admin/campanias", () => {
  it("operator: 404 sin datos (guard admin+)", async () => {
    login(operador)
    const res = await lista.GET(req("/api/admin/campanias"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(NOT_FOUND)
  })

  it("POST válido: 201 con el id; GET la lista", async () => {
    const ahora = await ahoraDb()
    const res = await lista.POST(req("/api/admin/campanias", { body: cuerpo(ahora) }))
    expect(res.status).toBe(201)
    const { id } = await json(res)
    expect(id).toEqual(expect.any(String))
    const l = await json(await lista.GET(req("/api/admin/campanias")))
    expect(l.campanias).toEqual([expect.objectContaining({ id, estado: "activa", productos: 1 })])
    const d = await json(await una.GET(req(`/api/admin/campanias/${id}`), ctx(id)))
    expect(d.campania.reglas).toHaveLength(1)
  })

  it("POST inválido: 400 con los errores", async () => {
    const ahora = await ahoraDb()
    const res = await lista.POST(req("/api/admin/campanias", { body: cuerpo(ahora, { reglas: [] }) }))
    expect(res.status).toBe(400)
    expect((await json(res)).errores).toContain("Agregue al menos una regla.")
  })

  it("POST con choque de fechas: 409", async () => {
    const ahora = await ahoraDb()
    await lista.POST(req("/api/admin/campanias", { body: cuerpo(ahora) }))
    const res = await lista.POST(req("/api/admin/campanias", { body: cuerpo(ahora, { nombre: "Otra" }) }))
    expect(res.status).toBe(409)
    expect((await json(res)).code).toBe("campania_superpuesta")
  })

  it("PUT de una terminada: 409; DELETE de una programada: 204; terminar una activa: 200", async () => {
    const ahora = await ahoraDb()
    const { id: activa } = await json(await lista.POST(req("/api/admin/campanias", { body: cuerpo(ahora) })))
    expect((await terminar.POST(req(`/api/admin/campanias/${activa}/terminar`, { method: "POST" }), ctx(activa))).status).toBe(200)
    const put = await una.PUT(req(`/api/admin/campanias/${activa}`, { method: "PUT", body: cuerpo(ahora) }), ctx(activa))
    expect(put.status).toBe(409)

    const { id: prog } = await json(
      await lista.POST(req("/api/admin/campanias", { body: cuerpo(ahora, { inicio: horas(ahora, 48), fin: horas(ahora, 72) }) })),
    )
    const del = await una.DELETE(req(`/api/admin/campanias/${prog}`, { method: "DELETE" }), ctx(prog))
    expect(del.status).toBe(204)
  })

  it("id que no es uuid: 404", async () => {
    const res = await una.GET(req("/api/admin/campanias/xx"), ctx("xx"))
    expect(res.status).toBe(404)
  })

  it("previsualizar: productos y bajo costo", async () => {
    const ahora = await ahoraDb()
    const res = await previa.POST(
      req("/api/admin/campanias/previsualizar", {
        body: { campania: cuerpo(ahora, { reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 50 }] }) },
      }),
    )
    expect(res.status).toBe(200)
    expect((await json(res)).previa).toMatchObject({ productos: 1, bajoCosto: 1, choque: null })
  })
})
