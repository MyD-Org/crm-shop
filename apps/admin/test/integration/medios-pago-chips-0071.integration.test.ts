import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { actualizarMedioPago, crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0071 (change `chips-medios-pago`): `medios_pago_shop.chips jsonb NOT NULL DEFAULT '[]'`
 * con CHECK de array. `shop_app` ya tiene SELECT de tabla entera (0046/0069): no hay GRANT nuevo.
 * Datos inventados.
 */

const A = "tenant-a"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
})
afterAll(async () => {
  await truncateAll()
})

async function codigo(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
  } catch (e) {
    for (let x: unknown = e, i = 0; x && i < 3; x = (x as { cause?: unknown }).cause, i++) {
      const c = (x as { code?: unknown }).code
      if (typeof c === "string") return c
    }
  }
  return null
}

describe("columna y CHECK de la 0071 (SQL directo)", () => {
  it("un medio nuevo nace sin chips", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect((await listarMediosPago(A))[0].chips).toEqual([])
  })

  it("rechaza que chips no sea un array (CHECK)", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    for (const v of [`'{}'`, `'"x"'`, `'5'`, `'null'`]) {
      expect(
        await codigo(getDb().execute(sql`update medios_pago_shop set chips = ${sql.raw(v)}::jsonb where tenant_id = ${A}`)),
        v,
      ).toBe("23514")
    }
  })

  it("no admite NULL", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect(await codigo(getDb().execute(sql`update medios_pago_shop set chips = null where tenant_id = ${A}`))).toBe("23502")
  })
})

describe("shop_app lee las etiquetas con el GRANT de tabla entera", () => {
  it("el bloque de GRANT vigente (0069) deja a shop_app leer chips; la transacción se revierte", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo", chips: [{ texto: "15% OFF", tono: "exito" }] })
    const sqlMigracion = readFileSync("drizzle/0069_medio_cuenta_corriente.sql", "utf8")
    const bloque = sqlMigracion.slice(sqlMigracion.lastIndexOf("DO $$"))
    const ROLLBACK = new Error("rollback")
    let filas: { slug: string; chips: unknown }[] = []
    await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql.raw(bloque))
        await tx.execute(sql`SET LOCAL ROLE shop_app`)
        filas = (await tx.execute(sql`select slug, chips from public.medios_pago_shop`)) as unknown as typeof filas
        throw ROLLBACK
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e
      })
    expect(filas).toEqual([{ slug: "efectivo", chips: [{ texto: "15% OFF", tono: "exito" }] }])
  })

  it("la 0071 no agrega GRANT (la columna se lee con el de tabla entera)", () => {
    const sqlMigracion = readFileSync("drizzle/0071_medios_pago_chips.sql", "utf8")
    const sinComentarios = sqlMigracion.replace(/^--.*$/gm, "")
    expect(sinComentarios.toUpperCase()).not.toContain("GRANT ")
  })
})

describe("repo del admin: etiquetas del medio", () => {
  it("guarda, reordena y quita chips, y el DTO los devuelve en el orden cargado", async () => {
    await crearMedioPago(A, { slug: "tarjeta", nombre: "Tarjeta" })
    const dos = [
      { texto: "Hasta 8 cuotas sin interés", tono: "destacado" },
      { texto: "Recomendado", tono: "exito" },
    ]
    expect(await actualizarMedioPago(A, "tarjeta", { chips: dos })).toMatchObject({ kind: "ok", medio: { chips: dos } })
    const invertidos = [...dos].reverse()
    await actualizarMedioPago(A, "tarjeta", { chips: invertidos })
    expect((await listarMediosPago(A))[0].chips).toEqual(invertidos)
    await actualizarMedioPago(A, "tarjeta", { chips: [] })
    expect((await listarMediosPago(A))[0].chips).toEqual([])
  })

  it("un cambio que no menciona chips los conserva", async () => {
    await crearMedioPago(A, { slug: "tarjeta", nombre: "Tarjeta", chips: [{ texto: "Promo del mes", tono: "info" }] })
    await actualizarMedioPago(A, "tarjeta", { nombre: "Tarjeta de crédito" })
    expect((await listarMediosPago(A))[0].chips).toEqual([{ texto: "Promo del mes", tono: "info" }])
  })

  it("chips inválidos: no cambia nada y el error va en usted", async () => {
    await crearMedioPago(A, { slug: "tarjeta", nombre: "Tarjeta", chips: [{ texto: "Promo", tono: "info" }] })
    const r = await actualizarMedioPago(A, "tarjeta", { chips: [{ texto: "<b>x</b>", tono: "info" }] })
    expect(r).toMatchObject({ kind: "invalid", campo: "chips" })
    expect((await listarMediosPago(A))[0].chips).toEqual([{ texto: "Promo", tono: "info" }])
  })

  it("lee de forma tolerante un valor que cumple el CHECK pero no la forma", async () => {
    await crearMedioPago(A, { slug: "tarjeta", nombre: "Tarjeta" })
    await getDb().execute(sql`update medios_pago_shop set chips = '[{"texto":"Bien","tono":"exito"},{"x":1},7]'::jsonb where tenant_id = ${A}`)
    expect((await listarMediosPago(A))[0].chips).toEqual([{ texto: "Bien", tono: "exito" }])
  })
})
