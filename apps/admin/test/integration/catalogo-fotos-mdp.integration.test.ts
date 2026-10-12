import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { FakeR2 } from "./fake-r2"
import { seedTenant, seedOperator, truncateAll } from "./helpers"

// Fotos y ficha de productos de cuenta secundaria (`mdp:<n>`): la key no puede llevar ":" y el
// prefijo ata el archivo a ESE producto. DB real, guard real, R2 falso.

let session: Record<string, unknown>
const r2 = vi.hoisted(() => ({ actual: null as unknown }))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: vi.fn(async () => {}) }))
vi.mock("@/lib/shop-media", async (orig) => ({
  ...(await orig<typeof import("@/lib/shop-media")>()),
  getShopMediaR2: () => r2.actual,
}))

const fotos = await import("@/app/api/admin/catalogo/productos/[alegraId]/fotos/route")
const ficha = await import("@/app/api/admin/catalogo/productos/[alegraId]/ficha/route")

const A = "tenant-a"
const UUID = "00000000-0000-4000-8000-000000000001"

const req = (method: string, body?: unknown) =>
  new NextRequest(`http://${A}.localhost/x`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { host: `${A}.localhost` },
  })
const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  const admin = await seedOperator(A, { role: "admin", email: "a@example.com" })
  session = { userId: admin, role: "admin", tenantId: A, name: "Ana", email: "ana@example.com", save: async () => {} }
  const db = getDb()
  for (const id of ["mdp:12", "mdp:120", "100"]) {
    await db.insert(catalogProducts).values({ tenantId: A, alegraId: id, name: `PRODUCTO ${id}`, status: "active", prices: [] })
  }
  r2.actual = new FakeR2()
})
afterAll(async () => {
  await truncateAll()
})

describe("fotos de un producto mdp:12", () => {
  it("POST firma keys sin ':' bajo productos/{tenant}/mdp_12/ (id llegado codificado o no)", async () => {
    for (const p of ["mdp:12", "mdp%3A12"]) {
      const res = await fotos.POST(req("POST", { id: UUID, variantes: [{ ancho: 320, bytes: 1000 }] }), params(p))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.variantes[0].key).toBe(`productos/${A}/mdp_12/${UUID}-320.webp`)
    }
  })

  it("PUT acepta la key propia y rechaza la de otro producto, otro tenant o con '..'", async () => {
    const ok = await fotos.PUT(
      req("PUT", { fotos: [{ key: `productos/${A}/mdp_12/${UUID}-320.webp`, w: 320 }] }),
      params("mdp:12"),
    )
    expect(ok.status).toBe(200)
    for (const key of [
      `productos/${A}/mdp_120/${UUID}-320.webp`,
      `productos/${A}/100/${UUID}-320.webp`,
      `productos/otro/mdp_12/${UUID}-320.webp`,
      `productos/${A}/mdp_12/../100/${UUID}-320.webp`,
    ]) {
      const res = await fotos.PUT(req("PUT", { fotos: [{ key, w: 320 }] }), params("mdp:12"))
      expect(res.status, key).toBe(422)
    }
  })

  it("un id mal formado es 404", async () => {
    for (const id of ["../x", "mdp:"]) {
      const res = await fotos.POST(req("POST", { variantes: [{ ancho: 320, bytes: 1000 }] }), params(id))
      expect(res.status, id).toBe(404)
    }
  })
})

describe("ficha de un producto mdp:12", () => {
  it("POST sin sha256 firma una key sin ':' y PUT la acepta; la de otro producto no", async () => {
    const res = await ficha.POST(req("POST", { nombre: "f.pdf", bytes: 1000 }), params("mdp:12"))
    expect(res.status).toBe(200)
    const { key } = await res.json()
    expect(key).toMatch(new RegExp(`^productos/${A}/mdp_12/ficha-`))
    expect(key.includes(":")).toBe(false)

    const ok = await ficha.PUT(req("PUT", { key, nombre: "f.pdf", bytes: 1000 }), params("mdp:12"))
    expect(ok.status).toBe(200)

    const ajena = `productos/${A}/mdp_120/ficha-${UUID}.pdf`
    const mal = await ficha.PUT(req("PUT", { key: ajena, nombre: "f.pdf", bytes: 1000 }), params("mdp:12"))
    expect(mal.status).toBe(422)
  })
})
