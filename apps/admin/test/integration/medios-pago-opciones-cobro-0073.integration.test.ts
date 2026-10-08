import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { actualizarMedioPago, crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { MSG_SIN_OPCIONES } from "@/lib/medios-pago-shop-opciones"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0073 (change `cuotas-en-el-formulario`, rebanada 1): `medios_pago_shop.opciones_cobro
 * text[] NOT NULL DEFAULT {credito,debito,cuenta_mp}` con CHECK de valores permitidos. `shop_app`
 * ya tiene SELECT de tabla entera (0046/0069): no hay GRANT nuevo. Datos inventados.
 */

const A = "tenant-a"
const TODAS = ["credito", "debito", "cuenta_mp"]

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

/** Las filas de cobro en línea las siembran migraciones (0057/0067); acá se simulan con SQL directo. */
async function sembrarCobro(slug: "mercadopago" | "payway") {
  await crearMedioPago(A, { slug: `${slug}-x`, nombre: slug })
  await getDb().execute(sql`update medios_pago_shop set slug = ${slug}, cobro_online = true where tenant_id = ${A} and slug = ${`${slug}-x`}`)
}

const medio = async (slug: string) => (await listarMediosPago(A)).find((m) => m.slug === slug)!

describe("columna y CHECK de la 0073 (SQL directo)", () => {
  it("un medio nuevo nace con todas las opciones", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect((await medio("efectivo")).opcionesCobro).toEqual(TODAS)
  })

  it("rechaza valores fuera de la lista (CHECK) y NULL", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect(
      await codigo(getDb().execute(sql`update medios_pago_shop set opciones_cobro = ARRAY['efectivo'] where tenant_id = ${A}`)),
    ).toBe("23514")
    expect(await codigo(getDb().execute(sql`update medios_pago_shop set opciones_cobro = null where tenant_id = ${A}`))).toBe("23502")
  })

  it("la lista vacía la admite la base (la regla de al menos una vive en el admin)", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect(await codigo(getDb().execute(sql`update medios_pago_shop set opciones_cobro = '{}' where tenant_id = ${A}`))).toBeNull()
  })

  it("la 0073 no agrega GRANT", () => {
    const sinComentarios = readFileSync("drizzle/0073_medios_pago_opciones_cobro.sql", "utf8").replace(/^--.*$/gm, "")
    expect(sinComentarios.toUpperCase()).not.toContain("GRANT ")
  })
})

describe("shop_app lee las opciones con el GRANT de tabla entera", () => {
  it("el bloque de GRANT vigente (0069) deja a shop_app leer opciones_cobro; la transacción se revierte", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    const sqlMigracion = readFileSync("drizzle/0069_medio_cuenta_corriente.sql", "utf8")
    const bloque = sqlMigracion.slice(sqlMigracion.lastIndexOf("DO $$"))
    const ROLLBACK = new Error("rollback")
    let filas: { slug: string; opciones_cobro: string[] }[] = []
    await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql.raw(bloque))
        await tx.execute(sql`SET LOCAL ROLE shop_app`)
        filas = (await tx.execute(sql`select slug, opciones_cobro from public.medios_pago_shop`)) as unknown as typeof filas
        throw ROLLBACK
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e
      })
    expect(filas).toEqual([{ slug: "efectivo", opciones_cobro: TODAS }])
  })
})

describe("repo del admin: opciones de cobro", () => {
  it("guarda un subconjunto y lo devuelve en orden canónico", async () => {
    await sembrarCobro("mercadopago")
    const r = await actualizarMedioPago(A, "mercadopago", { opcionesCobro: ["cuenta_mp", "credito"] })
    expect(r).toMatchObject({ kind: "ok", medio: { opcionesCobro: ["credito", "cuenta_mp"] } })
    expect((await medio("mercadopago")).opcionesCobro).toEqual(["credito", "cuenta_mp"])
  })

  it("activo con cobro en línea sin ninguna opción: rechaza y no cambia nada", async () => {
    await sembrarCobro("mercadopago")
    const r = await actualizarMedioPago(A, "mercadopago", { opcionesCobro: [] })
    expect(r).toEqual({ kind: "invalid", campo: "opcionesCobro", error: MSG_SIN_OPCIONES })
    expect((await medio("mercadopago")).opcionesCobro).toEqual(TODAS)
  })

  it("Payway con sólo la cuenta de Mercado Pago no tiene opciones aplicables: rechaza", async () => {
    await sembrarCobro("payway")
    expect(await actualizarMedioPago(A, "payway", { opcionesCobro: ["cuenta_mp"] })).toMatchObject({
      kind: "invalid",
      campo: "opcionesCobro",
    })
  })

  it("inactivo puede quedar sin opciones; reactivarlo así se rechaza (estado resultante)", async () => {
    await sembrarCobro("mercadopago")
    expect(await actualizarMedioPago(A, "mercadopago", { activo: false, opcionesCobro: [] })).toMatchObject({ kind: "ok" })
    expect(await actualizarMedioPago(A, "mercadopago", { activo: true })).toMatchObject({
      kind: "invalid",
      campo: "opcionesCobro",
    })
    expect((await medio("mercadopago")).activo).toBe(false)
  })

  it("un medio sin cobro en línea acepta la lista vacía (las opciones no tienen efecto)", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    expect(await actualizarMedioPago(A, "transferencia", { opcionesCobro: [] })).toMatchObject({ kind: "ok" })
  })

  it("un cambio que no menciona las opciones las conserva", async () => {
    await sembrarCobro("mercadopago")
    await actualizarMedioPago(A, "mercadopago", { opcionesCobro: ["debito"] })
    await actualizarMedioPago(A, "mercadopago", { nombre: "Mercado Pago" })
    expect((await medio("mercadopago")).opcionesCobro).toEqual(["debito"])
  })
})
