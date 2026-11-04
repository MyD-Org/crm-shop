import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { sql } from "drizzle-orm"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { getDb } from "@/db"
import { catalogOverlay, catalogProducts } from "@/db/schema"
import { listarDemandaReingreso, listarInteresadosDe } from "@/lib/avisos-reingreso-repo"
import { seedOperator, seedShopAviso, seedTenant, truncateAll } from "./helpers"

// Pestaña "Avisos de stock" (S3 de aviso-reingreso): repo + API. Base real (crm_test) con el esquema
// `shop` de las migraciones REALES del Shop (0043 incluida). Datos inventados, mails @cliente.example.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET: route } = await import("@/app/api/admin/avisos-reingreso/route")

const A = "tenant-a"
const B = "tenant-b"
const hace = (min: number) => new Date(Date.now() - min * 60_000)

describe("avisos de stock: repo", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(A)
    await seedTenant(B)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("agrupa por producto sobre avisos pendientes y ordena por personas desc, luego más reciente", async () => {
    await seedShopAviso(A, "10", "ana@cliente.example", { cantidad: 2, createdAt: hace(30) })
    await seedShopAviso(A, "10", "beto@cliente.example", { cantidad: 3, quiereEncargar: true, createdAt: hace(10) })
    await seedShopAviso(A, "20", "ana@cliente.example", { createdAt: hace(5) })
    await seedShopAviso(A, "30", "ana@cliente.example", { createdAt: hace(60) })

    const { items, total } = await listarDemandaReingreso(A)
    expect(total).toBe(3)
    expect(items.map((i) => i.alegraId)).toEqual(["10", "20", "30"])
    expect(items[0]).toMatchObject({ interesados: 2, unidades: 5, quierenEncargar: 1 })
    expect(new Date(items[0].primerPedido).getTime()).toBeLessThan(new Date(items[0].ultimoPedido).getTime())
  })

  it("excluye avisados y dados de baja", async () => {
    await seedShopAviso(A, "10", "ana@cliente.example")
    await seedShopAviso(A, "10", "avisada@cliente.example", { avisadoAt: new Date() })
    await seedShopAviso(A, "10", "baja@cliente.example", { unsubscribedAt: new Date() })
    await seedShopAviso(A, "99", "solo-baja@cliente.example", { unsubscribedAt: new Date() })

    const { items, total } = await listarDemandaReingreso(A)
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({ alegraId: "10", interesados: 1 })
    expect((await listarInteresadosDe(A, "10")).map((i) => i.email)).toEqual(["ana@cliente.example"])
    expect(await listarInteresadosDe(A, "99")).toEqual([])
  })

  it("aísla por tenant", async () => {
    await seedShopAviso(A, "10", "ana@cliente.example")
    await seedShopAviso(B, "10", "otra@cliente.example")
    await seedShopAviso(B, "77", "otra@cliente.example")

    const a = await listarDemandaReingreso(A)
    expect(a.items.map((i) => i.alegraId)).toEqual(["10"])
    expect(a.items[0].interesados).toBe(1)
    expect((await listarInteresadosDe(A, "10")).map((i) => i.email)).toEqual(["ana@cliente.example"])
    expect(await listarInteresadosDe(A, "77")).toEqual([])
  })

  it("filtro quieren_encargar: solo productos con al menos una persona que lo encargaría", async () => {
    await seedShopAviso(A, "10", "ana@cliente.example")
    await seedShopAviso(A, "20", "ana@cliente.example", { quiereEncargar: true })
    await seedShopAviso(A, "20", "beto@cliente.example")

    const { items, total } = await listarDemandaReingreso(A, { filtro: "quieren_encargar" })
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({ alegraId: "20", interesados: 2, quierenEncargar: 1 })
  })

  it("nombre: overlay > espejo > id crudo (variante o cuenta de otra sucursal)", async () => {
    await getDb().insert(catalogProducts).values([
      { tenantId: A, alegraId: "10", name: "Panel LED 18W", brand: "Marca Test", prices: [], status: "active" },
      { tenantId: A, alegraId: "20", name: "Lámpara base", brand: null, prices: [], status: "active" },
      // Mismo alegra_id en el otro tenant: no debe filtrarse a este.
      { tenantId: B, alegraId: "30", name: "Producto de B", brand: null, prices: [], status: "active" },
    ])
    await getDb().insert(catalogOverlay).values({ tenantId: A, alegraId: "20", nombre: "Lámpara editada" })
    await seedShopAviso(A, "10", "ana@cliente.example")
    await seedShopAviso(A, "20", "ana@cliente.example")
    await seedShopAviso(A, "30", "ana@cliente.example")
    await seedShopAviso(A, "mdp:55", "ana@cliente.example")

    const { items } = await listarDemandaReingreso(A)
    const nombre = Object.fromEntries(items.map((i) => [i.alegraId, i.nombre]))
    expect(nombre).toEqual({
      "10": "Panel LED 18W",
      "20": "Lámpara editada",
      "30": "30",
      "mdp:55": "mdp:55",
    })
    expect(items.find((i) => i.alegraId === "10")?.marca).toBe("Marca Test")
  })

  it("pagina con start/limit", async () => {
    for (let i = 1; i <= 5; i++) await seedShopAviso(A, `p${i}`, "ana@cliente.example", { createdAt: hace(i) })
    const pag = await listarDemandaReingreso(A, { start: 2, limit: 2 })
    expect(pag.total).toBe(5)
    expect(pag.items.map((i) => i.alegraId)).toEqual(["p3", "p4"])
  })

  it("interesados: más nuevo primero, WhatsApp solo con consentimiento", async () => {
    await seedShopAviso(A, "10", "vieja@cliente.example", { createdAt: hace(60) })
    await seedShopAviso(A, "10", "nueva@cliente.example", {
      createdAt: hace(5),
      whatsapp: "+5491155550000",
      consentimientoContacto: true,
      cantidad: 4,
      quiereEncargar: true,
    })
    const lista = await listarInteresadosDe(A, "10")
    expect(lista.map((i) => i.email)).toEqual(["nueva@cliente.example", "vieja@cliente.example"])
    expect(lista[0]).toMatchObject({ whatsapp: "+5491155550000", cantidad: 4, quiereEncargar: true })
    expect(lista[1].whatsapp).toBeNull()
  })

  it("interesados: tope de 200 personas por producto", async () => {
    const getdb = getDb()
    await seedShopAviso(A, "10", "uno@cliente.example")
    await getdb.execute(
      sql`
        insert into shop.avisos_reingreso (tenant_id, alegra_id, email, token_baja)
        select ${A}, '10', 'p' || g || '@cliente.example', 'tok-' || g from generate_series(1, 250) g`,
    )
    expect(await listarInteresadosDe(A, "10")).toHaveLength(200)
  })
})

describe("avisos de stock: API", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(A)
    await seedTenant(B)
    invalidateTenantRegistry()
    login(await seedOperator(A, { role: "admin" }))
  })

  afterAll(async () => {
    await truncateAll()
  })

  function login(userId: string) {
    session = { mfa: "ok", userId, role: "admin", tenantId: A, name: "Nombre", email: "cookie@example.com", save: async () => {} }
  }

  const get = (qs = "") =>
    route(new NextRequest(`http://tenant-a.localhost/api/admin/avisos-reingreso${qs}`, { headers: { host: "tenant-a.localhost" } }))

  it("devuelve la demanda del tenant de la sesión", async () => {
    await seedShopAviso(A, "10", "ana@cliente.example")
    await seedShopAviso(B, "10", "otra@cliente.example")
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ alegraId: "10", interesados: 1 })
  })

  it("?producto= devuelve las personas", async () => {
    await seedShopAviso(A, "mdp:5", "ana@cliente.example")
    const res = await get("?producto=mdp%3A5")
    expect((await res.json()).items.map((i: { email: string }) => i.email)).toEqual(["ana@cliente.example"])
  })

  it("parámetros inválidos → 400", async () => {
    expect((await get("?filtro=zzz")).status).toBe(400)
    expect((await get("?start=-1")).status).toBe(400)
    expect((await get("?limit=0")).status).toBe(400)
    expect((await get("?producto=")).status).toBe(400)
  })

  it("sin sesión => 401 y operador => 404, sin datos", async () => {
    await seedShopAviso(A, "10", "ana@cliente.example")
    session = {}
    expect((await get()).status).toBe(401)
    login(await seedOperator(A, { role: "operator" }))
    const res = await get()
    expect(res.status).toBe(404)
    expect((await res.json()).items).toBeUndefined()
  })
})
