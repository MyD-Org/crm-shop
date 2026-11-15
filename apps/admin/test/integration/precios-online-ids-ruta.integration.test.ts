import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { seedOperator, seedTenant, truncateAll } from "./helpers"
import { seedProducto } from "./precios-online-helpers"

// R5.5.2: GET /api/admin/catalogo/precios-online?modo=ids (selección masiva). Guard real; datos inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const grillaRuta = await import("@/app/api/admin/catalogo/precios-online/route")

const A = "tenant-a"
const B = "tenant-b"

function login(userId: string, role: "admin" | "operator", tenantId = A) {
  session = { mfa: "ok", userId, role, tenantId, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
}
const req = (query: string) =>
  new NextRequest(`http://${A}.localhost/api/admin/catalogo/precios-online${query}`, { headers: { host: `${A}.localhost` } })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Record<string, any>

let admin: string
let operador: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  admin = await seedOperator(A, { role: "admin", email: "a@example.com" })
  operador = await seedOperator(A, { role: "operator", email: "op@example.com" })
  login(admin, "admin")
}, 60_000)
afterAll(async () => {
  await truncateAll()
})

describe("modo=ids", () => {
  it("operator -> 404", async () => {
    login(operador, "operator")
    const res = await grillaRuta.GET(req("?modo=ids"))
    expect(res.status).toBe(404)
  })

  it("devuelve ids, nombre y código con los mismos filtros que la grilla, sólo del tenant del guard", async () => {
    await seedProducto(A, { alegraId: "a1", costo: "10", brand: "acme" })
    await seedProducto(A, { alegraId: "a2", costo: "10", brand: "acme" })
    await seedProducto(A, { alegraId: "a3", costo: "10", brand: "otra" })
    await seedProducto(B, { alegraId: "b1", costo: "10", brand: "acme" })
    const r = await json(await grillaRuta.GET(req("?modo=ids&marca=acme")))
    expect(r.total).toBe(2)
    expect(r.items.map((i: { alegraId: string }) => i.alegraId).sort()).toEqual(["a1", "a2"])
    expect(r.items[0]).toHaveProperty("nombre")
    expect(r.items[0]).toHaveProperty("codigo")
    const grilla = await json(await grillaRuta.GET(req("?marca=acme")))
    expect(grilla.total).toBe(r.total)
  })

  it("filtros inválidos -> 4xx", async () => {
    const res = await grillaRuta.GET(req("?modo=ids&estado=raro"))
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
