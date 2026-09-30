import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { crearSucursal } from "@/lib/sucursales-repo"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// /api/agent/catalog no tiene noción de zona: descarta lo oculto en TODAS las sucursales activas
// y deja lo oculto en algunas. Datos inventados.

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))

const { GET } = await import("@/app/api/agent/catalog/route")

const A = "tenant-a"
const PRECIO = '[{"idPriceList":"1","name":"General","price":100}]'
const SECRET = "secreto-de-test"

const buscar = async (): Promise<string[]> => {
  const res = await GET(
    new Request("http://tenant-a.localhost/api/agent/catalog?q=lampara", {
      headers: { authorization: `Bearer ${SECRET}`, host: "tenant-a.localhost" },
    }),
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { products: { id: string }[] }).products.map((p) => p.id).sort()
}

beforeEach(async () => {
  vi.stubEnv("INTERNAL_SECRET", SECRET)
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, catalog_overlay restart identity cascade`)
  await seedTenant(A)
  invalidateTenantRegistry()
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  for (const id of ["1", "2", "3", "4"]) {
    await getDb().execute(
      sql`INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock) VALUES (${A}, ${id}, ${"C" + id}, ${"Lampara " + id}, ${PRECIO}::jsonb, 5)`,
    )
  }
  // 1: sin overlay. 2: oculto en mdp. 3: oculto en las dos. 4: oculto en igz y en una que no existe.
  await guardarOverlay(A, "2", { visible: true, ocultoEnSucursales: ["mdp"] })
  await guardarOverlay(A, "3", { visible: true, ocultoEnSucursales: ["igz", "mdp"] })
  await guardarOverlay(A, "4", { visible: true, ocultoEnSucursales: ["igz"] })
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await truncateAll()
})

describe("GET /api/agent/catalog: oculto en sucursales", () => {
  it("no ofrece lo oculto en todas las sucursales activas", async () => {
    expect(await buscar()).toEqual(["1", "2", "4"])
  })

  it("una sucursal dada de baja no cuenta: lo oculto en las activas ya no se ofrece", async () => {
    await getDb().execute(sql`UPDATE sucursales SET activa = false WHERE tenant_id = ${A} AND slug = 'mdp'`)
    // activas = igz: el 3 y el 4 (ocultos en igz) quedan afuera.
    expect(await buscar()).toEqual(["1", "2"])
  })

  it("sin sucursales activas no excluye nada", async () => {
    await getDb().execute(sql`UPDATE sucursales SET activa = false WHERE tenant_id = ${A}`)
    expect(await buscar()).toEqual(["1", "2", "3", "4"])
  })
})
