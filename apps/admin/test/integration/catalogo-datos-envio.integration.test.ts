import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { guardarDatosEnvio, leerDatosEnvio } from "@/lib/catalogo-datos-envio-repo"
import type { DatosEnvio } from "@/lib/catalogo-datos-envio"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Datos de envío por producto (migración 0107): repo (upsert, 'manual' le gana a la carga
// automática, aislamiento por tenant) y GET .../envio con el guard real.

let session: Record<string, unknown>
vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const ruta = await import("@/app/api/admin/catalogo/productos/[alegraId]/envio/route")

const A = "tenant-a"
const B = "tenant-b"
const req = () => new NextRequest(`http://${A}.localhost/api/admin/catalogo/productos/100/envio`, { headers: { host: `${A}.localhost` } })
const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

const coresa: DatosEnvio = { pesoKg: 1.12, altoCm: 9, anchoCm: 11, largoCm: 11.5, unidadMinima: 1, unidadesPorCaja: 60, fuente: "coresa" }

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  const admin = await seedOperator(A, { role: "admin", email: "a@example.com" })
  session = { mfa: "ok", userId: admin, role: "admin", tenantId: A, name: "Ana", email: "ana@example.com", save: async () => {} }
  await getDb().insert(catalogProducts).values([
    { tenantId: A, alegraId: "100", name: "REFLECTOR LED 50W", status: "active", prices: [] },
    { tenantId: A, alegraId: "101", name: "TERMICA 2X16", status: "active", prices: [] },
  ])
})
afterAll(async () => {
  await truncateAll()
})

describe("guardarDatosEnvio / leerDatosEnvio", () => {
  it("inserta, lee con números y actualiza", async () => {
    expect(await guardarDatosEnvio(A, [{ alegraId: "100", datos: coresa }])).toBe(1)
    expect(await leerDatosEnvio(A, "100")).toMatchObject({ ...coresa })
    expect(await guardarDatosEnvio(A, [{ alegraId: "100", datos: { ...coresa, pesoKg: null, unidadesPorCaja: 50 } }])).toBe(1)
    expect(await leerDatosEnvio(A, "100")).toMatchObject({ pesoKg: null, unidadesPorCaja: 50 })
  })

  it("una carga automática no pisa un dato manual; una manual sí pisa una automática", async () => {
    await guardarDatosEnvio(A, [{ alegraId: "100", datos: { ...coresa, fuente: "manual", pesoKg: 2 } }])
    expect(await guardarDatosEnvio(A, [{ alegraId: "100", datos: coresa }])).toBe(0)
    expect((await leerDatosEnvio(A, "100"))?.pesoKg).toBe(2)

    await guardarDatosEnvio(A, [{ alegraId: "101", datos: coresa }])
    expect(await guardarDatosEnvio(A, [{ alegraId: "101", datos: { ...coresa, fuente: "manual", pesoKg: 3 } }])).toBe(1)
    expect(await leerDatosEnvio(A, "101")).toMatchObject({ pesoKg: 3, fuente: "manual" })
  })

  it("aislado por tenant", async () => {
    await guardarDatosEnvio(B, [{ alegraId: "100", datos: coresa }])
    expect(await leerDatosEnvio(A, "100")).toBeNull()
  })

  it("la base rechaza valores no positivos", async () => {
    await expect(
      getDb().execute(sql`INSERT INTO catalog_datos_envio (tenant_id, alegra_id, peso_kg, fuente) VALUES (${A}, '100', 0, 'manual')`),
    ).rejects.toThrow()
  })
})

describe("GET /api/admin/catalogo/productos/[alegraId]/envio", () => {
  it("devuelve los datos o null", async () => {
    await guardarDatosEnvio(A, [{ alegraId: "100", datos: coresa }])
    const r = await ruta.GET(req(), params("100"))
    expect(r.status).toBe(200)
    expect((await r.json()).datosEnvio).toMatchObject({ pesoKg: 1.12, largoCm: 11.5, fuente: "coresa" })
    const vacio = await ruta.GET(req(), params("101"))
    expect((await vacio.json()).datosEnvio).toBeNull()
  })

  it("producto inexistente → 404", async () => {
    const r = await ruta.GET(req(), params("999"))
    expect(r.status).toBe(404)
  })
})
