import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { limpiarFacturaCuenta, registrarFacturaCuenta } from "@/lib/pedido-factura-cuenta-repo"
import { seedShopOrder, seedTenant, truncateAll } from "./helpers"

/**
 * `shop.orders.factura_cruzada` (0024 del Shop, change `sucursales-igz-mdp` rebanada B) escrita por
 * el CRM al emitir y limpiada al desvincular. Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"
const db = () => getDb()
let cuentaA: string

const cruzada = async (id: string) =>
  ((await db().execute(sql`select factura_cruzada from shop.orders where id = ${id}::uuid`))[0] as { factura_cruzada: boolean }).factura_cruzada

afterAll(async () => {
  await truncateAll()
})

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await seedTenant(B)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'A', true)`)
  cuentaA = ((await db().execute(sql`SELECT id FROM alegra_cuentas WHERE tenant_id = ${A}`))[0] as { id: string }).id
})

describe("factura_cruzada en shop.orders", () => {
  it("emitir una factura cruzada la marca en shop.orders y desvincular la vuelve a false", async () => {
    const p = await seedShopOrder(A)
    expect(await cruzada(p.id)).toBe(false)
    await registrarFacturaCuenta(A, p.id, { cuentaId: cuentaA, cruzada: true, now: new Date() })
    expect(await cruzada(p.id)).toBe(true)
    await limpiarFacturaCuenta(A, p.id)
    expect(await cruzada(p.id)).toBe(false)
  })

  it("una factura no cruzada deja la marca en false", async () => {
    const p = await seedShopOrder(A)
    await registrarFacturaCuenta(A, p.id, { cuentaId: cuentaA, cruzada: false, now: new Date() })
    expect(await cruzada(p.id)).toBe(false)
  })

  it("solo toca pedidos del tenant indicado", async () => {
    const ajeno = await seedShopOrder(B)
    await registrarFacturaCuenta(A, ajeno.id, { cuentaId: cuentaA, cruzada: true, now: new Date() })
    expect(await cruzada(ajeno.id)).toBe(false)
  })

  it("limpiar dentro de una transacción escribe con el mismo ejecutor", async () => {
    const p = await seedShopOrder(A)
    await registrarFacturaCuenta(A, p.id, { cuentaId: cuentaA, cruzada: true, now: new Date() })
    await db().transaction(async (tx) => {
      await limpiarFacturaCuenta(A, p.id, tx)
    })
    expect(await cruzada(p.id)).toBe(false)
  })
})
