import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { seedTenant, truncateAll } from "./helpers"

// Migración 0044 (change `sucursales-igz-mdp`, rebanada D, lote 3): `pedido_factura_cuenta`, una
// fila por pedido con la cuenta elegida y la que facturó. Solo estructura.

const db = () => getDb()
const ORDER = "11111111-1111-4111-8111-111111111111"
let cuentaA: string
let cuentaB: string

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table alegra_cuentas restart identity cascade`)
  await seedTenant("tenant-a")
  await seedTenant("tenant-b")
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES ('tenant-a', 'principal', 'A', true), ('tenant-b', 'principal', 'B', true)`)
  const filas = [...(await db().execute(sql`SELECT id, tenant_id FROM alegra_cuentas`))] as { id: string; tenant_id: string }[]
  cuentaA = filas.find((f) => f.tenant_id === "tenant-a")!.id
  cuentaB = filas.find((f) => f.tenant_id === "tenant-b")!.id
})
afterAll(async () => {
  await truncateAll()
})

describe("pedido_factura_cuenta (0044)", () => {
  it("una fila por (tenant, pedido); la factura cruzada arranca en false", async () => {
    await db().execute(sql`INSERT INTO pedido_factura_cuenta (tenant_id, order_id, factura_cuenta_id) VALUES ('tenant-a', ${ORDER}, ${cuentaA}::uuid)`)
    const [f] = [...(await db().execute(sql`SELECT factura_cruzada FROM pedido_factura_cuenta`))] as { factura_cruzada: boolean }[]
    expect(f.factura_cruzada).toBe(false)
    await expect(
      db().execute(sql`INSERT INTO pedido_factura_cuenta (tenant_id, order_id) VALUES ('tenant-a', ${ORDER})`),
    ).rejects.toThrow()
  })

  it("no admite una cuenta de OTRO tenant (FK compuesta) en ninguna de las tres columnas", async () => {
    for (const col of ["cuenta_override_id", "override_anterior_id", "factura_cuenta_id"]) {
      await expect(
        db().execute(sql`INSERT INTO pedido_factura_cuenta (tenant_id, order_id, ${sql.raw(col)}) VALUES ('tenant-a', ${ORDER}, ${cuentaB}::uuid)`),
      ).rejects.toThrow()
    }
  })
})
