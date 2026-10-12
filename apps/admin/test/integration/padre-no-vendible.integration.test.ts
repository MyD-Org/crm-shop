import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { esVendibleSql } from "@/lib/catalogo-vendible"
import { revisionDeCatalogo } from "@/lib/catalogo-revision"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// El padre de un producto con variantes nunca es vendible (change `variantes-de-producto`, S2),
// aunque tenga precio, stock null y estado activo. Datos inventados.

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))

const { GET } = await import("@/app/api/agent/catalog/route")

const A = "tenant-a"
const PRECIO = '[{"idPriceList":"1","name":"General","price":100}]'
const SECRET = "secreto-de-test"

const buscar = async (q: string): Promise<string[]> => {
  const res = await GET(
    new Request(`http://tenant-a.localhost/api/agent/catalog?q=${encodeURIComponent(q)}`, {
      headers: { authorization: `Bearer ${SECRET}`, host: "tenant-a.localhost" },
    }),
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { products: { id: string }[] }).products.map((p) => p.id).sort()
}

async function fila(id: string, name: string, tipo: "simple" | "padre" | "variante", extra: { stock?: number | null; padre?: string } = {}) {
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock, tipo, padre_alegra_id)
    VALUES (${A}, ${id}, NULL, ${name}, ${PRECIO}::jsonb, ${extra.stock === undefined ? 5 : extra.stock}, ${tipo}, ${extra.padre ?? null})
  `)
}

beforeEach(async () => {
  vi.stubEnv("INTERNAL_SECRET", SECRET)
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, catalog_overlay restart identity cascade`)
  await seedTenant(A)
  invalidateTenantRegistry()
  await fila("P", "Cinta LED", "padre", { stock: null })
  await fila("v1", "Cinta LED / Verde", "variante", { padre: "P" })
  await fila("v2", "Cinta LED / Rojo", "variante", { padre: "P" })
  await fila("s1", "Cinta LED simple", "simple")
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await truncateAll()
})

describe("el padre no es vendible", () => {
  it("el bot busca por el nombre del modelo y recibe variantes, nunca el padre", async () => {
    expect(await buscar("cinta")).toEqual(["s1", "v1", "v2"])
  })

  it("esVendibleSql excluye al padre y deja pasar variantes y simples", async () => {
    const rows = (await getDb().execute(
      sql`SELECT alegra_id FROM catalog_products p WHERE p.tenant_id = ${A} AND ${esVendibleSql("p")} ORDER BY alegra_id`,
    )) as unknown as { alegra_id: string }[]
    expect(rows.map((r) => r.alegra_id)).toEqual(["s1", "v1", "v2"])
  })

  it("'Códigos a revisar' (solo en cuenta secundaria) no lista al padre secundario", async () => {
    const [cuenta] = (await getDb().execute(
      sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'mdp', 'Cuenta secundaria', false) RETURNING id`,
    )) as unknown as { id: string }[]
    for (const [id, tipo] of [["mdp:1", "padre"], ["mdp:2", "variante"]] as const) {
      await getDb().execute(sql`
        INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, cuenta_id, alegra_id_cuenta, prices, stock)
        VALUES (${A}, ${id}, ${"Pantalla " + id}, ${tipo}, ${cuenta.id}::uuid, ${id.split(":")[1]}, ${PRECIO}::jsonb, 1)
      `)
    }
    const rev = await revisionDeCatalogo(A)
    const items = rev.flatMap((c) => c.soloEnCuenta.items.map((i) => i.alegraId))
    expect(items).toEqual(["mdp:2"])
    expect(rev[0].soloEnCuenta.total).toBe(1)
  })
})
