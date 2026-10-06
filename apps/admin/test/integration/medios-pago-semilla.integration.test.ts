import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { sembrarMedioMercadoPago, sembrarMedioPayway } from "@/db/medios-pago-semilla"
import { crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Alta de tenant (`seed-tenant.ts`): siembra la fila fija `mercadopago` (inactiva, cobro online) igual
 * que la migración 0057. Idempotente y sin pisar una fila existente. Datos inventados.
 */

const A = "tenant-semilla-a"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
})
afterAll(async () => {
  await truncateAll()
})

describe("sembrarMedioMercadoPago", () => {
  it("crea mercadopago inactivo, con cobro online y al final del orden", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia", orden: 4 })
    await sembrarMedioMercadoPago(getDb(), A)
    const mp = (await listarMediosPago(A)).find((m) => m.slug === "mercadopago")
    expect(mp).toMatchObject({ nombre: "Mercado Pago", activo: false, cobroOnline: true, aplicaRetiro: true, aplicaEnvio: true, orden: 5 })
  })

  it("tenant sin medios: orden 0", async () => {
    await sembrarMedioMercadoPago(getDb(), A)
    expect((await listarMediosPago(A)).map((m) => [m.slug, m.orden])).toEqual([["mercadopago", 0]])
  })

  it("es idempotente y no pisa una fila ya editada", async () => {
    await sembrarMedioMercadoPago(getDb(), A)
    await getDb().execute(sql`UPDATE medios_pago_shop SET activo = true, orden = 9 WHERE tenant_id = ${A} AND slug = 'mercadopago'`)
    await sembrarMedioMercadoPago(getDb(), A)
    const filas = (await listarMediosPago(A)).filter((m) => m.slug === "mercadopago")
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ activo: true, orden: 9 })
  })
})

describe("sembrarMedioPayway", () => {
  it("crea payway inactivo, con cobro online, después de mercadopago, y es idempotente", async () => {
    await sembrarMedioMercadoPago(getDb(), A)
    await sembrarMedioPayway(getDb(), A)
    await sembrarMedioPayway(getDb(), A)
    const medios = await listarMediosPago(A)
    expect(medios.map((m) => [m.slug, m.orden])).toEqual([["mercadopago", 0], ["payway", 1]])
    expect(medios[1]).toMatchObject({
      nombre: "Tarjeta de crédito o débito - Payway",
      activo: false,
      cobroOnline: true,
      aplicaRetiro: true,
      aplicaEnvio: true,
    })
  })
})
