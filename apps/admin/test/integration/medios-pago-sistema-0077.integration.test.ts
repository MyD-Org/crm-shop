import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearMedioPago, eliminarMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0077: repone transferencia y efectivo por tenant si faltan (desactivados, al final del
 * orden) sin tocar los que existen, y esos medios no se pueden eliminar. Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})
afterAll(async () => {
  await truncateAll()
})

async function correrMigracion() {
  const texto = readFileSync("./drizzle/0077_medios_sistema.sql", "utf8")
  await getDb().execute(sql.raw(texto))
}

describe("0077: medios del sistema", () => {
  it("repone lo que falta, desactivado y al final del orden, y es idempotente", async () => {
    await crearMedioPago(A, { slug: "propio", nombre: "Propio", orden: 4 })
    await correrMigracion()
    await correrMigracion()
    const medios = await listarMediosPago(A)
    expect(medios.map((m) => [m.slug, m.orden, m.activo])).toEqual([
      ["propio", 4, true],
      ["transferencia", 5, false],
      ["efectivo", 6, false],
    ])
    expect(medios.find((m) => m.slug === "transferencia")).toMatchObject({ nombre: "Transferencia bancaria", aplicaEnvio: true })
    expect(medios.find((m) => m.slug === "efectivo")).toMatchObject({ nombre: "Efectivo en el local", aplicaEnvio: false })
    expect((await listarMediosPago(B)).map((m) => m.slug)).toEqual(["transferencia", "efectivo"])
  })

  it("no pisa los que ya existen", async () => {
    await getDb().execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre, orden) values (${A}, 'transferencia', 'Mi transferencia', 0)`)
    await correrMigracion()
    const t = (await listarMediosPago(A)).find((m) => m.slug === "transferencia")!
    expect(t).toMatchObject({ nombre: "Mi transferencia", activo: true, orden: 0 })
  })
})

describe("eliminar medios del sistema", () => {
  it("transferencia y efectivo se rechazan con el mismo conflicto que Mercado Pago", async () => {
    await correrMigracion()
    for (const slug of ["transferencia", "efectivo"]) {
      expect(await eliminarMedioPago(A, slug)).toEqual({ kind: "conflict", error: "Este medio de pago no se puede eliminar; desactívelo." })
    }
    expect((await listarMediosPago(A)).map((m) => m.slug)).toEqual(["transferencia", "efectivo"])
  })
})
