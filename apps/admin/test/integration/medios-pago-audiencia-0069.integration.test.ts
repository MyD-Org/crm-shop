import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { actualizarMedioPago, crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0069 (change `listas-cuenta-corriente`, rebanada B): `medios_pago_shop.audiencia`.
 * Un solo medio "solo cuentas corrientes" por tenant, sin cobro en línea ni destacado/ficha;
 * `shop_app` lo lee con el SELECT de tabla entera. Datos inventados.
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

describe("columna y restricciones de la 0069 (SQL directo)", () => {
  it("los medios existentes y los nuevos nacen 'publico'", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect((await listarMediosPago(A))[0].audiencia).toBe("publico")
  })

  it("rechaza un valor de audiencia desconocido (CHECK)", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect(await codigo(getDb().execute(sql`update medios_pago_shop set audiencia = 'todos' where tenant_id = ${A}`))).toBe("23514")
  })

  it("un medio de cuenta corriente no puede cobrar en línea, destacarse ni mostrarse en la ficha (CHECK)", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    for (const col of ["cobro_online", "destacar_en_catalogo", "mostrar_en_ficha"]) {
      expect(
        await codigo(
          getDb().execute(sql`update medios_pago_shop set audiencia = 'cuenta_corriente', ${sql.raw(col)} = true where tenant_id = ${A}`),
        ),
        col,
      ).toBe("23514")
    }
  })

  it("a lo sumo un medio de cuenta corriente por tenant (índice único parcial); otro tenant puede tener el suyo", async () => {
    await crearMedioPago(A, { slug: "uno", nombre: "Uno" })
    await crearMedioPago(A, { slug: "dos", nombre: "Dos" })
    await crearMedioPago(B, { slug: "uno", nombre: "Uno" })
    await getDb().execute(sql`update medios_pago_shop set audiencia = 'cuenta_corriente' where tenant_id = ${A} and slug = 'uno'`)
    expect(
      await codigo(getDb().execute(sql`update medios_pago_shop set audiencia = 'cuenta_corriente' where tenant_id = ${A} and slug = 'dos'`)),
    ).toBe("23505")
    await getDb().execute(sql`update medios_pago_shop set audiencia = 'cuenta_corriente' where tenant_id = ${B} and slug = 'uno'`)
  })
})

describe("shop_app lee la audiencia", () => {
  it("el bloque de GRANT de la 0069 deja a shop_app leer la columna (tabla entera); la transacción se revierte", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    // Los roles se crean DESPUÉS de migrar la plantilla: se corre el bloque real del .sql, dentro de
    // una transacción que siempre se revierte (no deja permisos en la base).
    const sqlMigracion = readFileSync("drizzle/0069_medio_cuenta_corriente.sql", "utf8")
    const bloque = sqlMigracion.slice(sqlMigracion.lastIndexOf("DO $$"))
    const ROLLBACK = new Error("rollback")
    let filas: { slug: string; audiencia: string }[] = []
    await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql.raw(bloque))
        await tx.execute(sql`SET LOCAL ROLE shop_app`)
        filas = (await tx.execute(sql`select slug, audiencia from public.medios_pago_shop`)) as unknown as typeof filas
        throw ROLLBACK
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e
      })
    expect(filas).toEqual([{ slug: "efectivo", audiencia: "publico" }])
  })
})

describe("repo del admin: marcar un medio como solo para cuentas corrientes", () => {
  it("marca y desmarca, y el DTO refleja la audiencia", async () => {
    await crearMedioPago(A, { slug: "efectivo-cheque", nombre: "Efectivo o cheque" })
    const r = await actualizarMedioPago(A, "efectivo-cheque", { audiencia: "cuenta_corriente" })
    expect(r).toMatchObject({ kind: "ok", medio: { audiencia: "cuenta_corriente" } })
    expect((await listarMediosPago(A))[0].audiencia).toBe("cuenta_corriente")
    const v = await actualizarMedioPago(A, "efectivo-cheque", { audiencia: "publico" })
    expect(v).toMatchObject({ kind: "ok", medio: { audiencia: "publico" } })
  })

  it("el alta puede nacer solo para cuentas corrientes", async () => {
    const r = await crearMedioPago(A, { slug: "cc", nombre: "CC", audiencia: "cuenta_corriente" })
    expect(r).toMatchObject({ kind: "ok", medio: { audiencia: "cuenta_corriente" } })
    const dup = await crearMedioPago(A, { slug: "cc2", nombre: "CC 2", audiencia: "cuenta_corriente" })
    expect(dup).toMatchObject({ kind: "conflict", campo: "audiencia" })
  })

  it("un segundo medio de cuenta corriente: conflicto en usted y no cambia nada", async () => {
    await crearMedioPago(A, { slug: "uno", nombre: "Uno" })
    await crearMedioPago(A, { slug: "dos", nombre: "Dos" })
    await actualizarMedioPago(A, "uno", { audiencia: "cuenta_corriente" })
    const r = await actualizarMedioPago(A, "dos", { audiencia: "cuenta_corriente" })
    expect(r).toEqual({
      kind: "conflict",
      campo: "audiencia",
      error: "Ya hay otro medio solo para cuentas corrientes. Quite esa opción del otro medio antes de marcar éste.",
    })
    expect((await listarMediosPago(A)).find((m) => m.slug === "dos")?.audiencia).toBe("publico")
  })

  it("no admite un medio de cobro en línea, uno destacado o en ficha, ni uno que no aplique a retiro y envío", async () => {
    await getDb().execute(sql`
      insert into medios_pago_shop (tenant_id, slug, nombre, cobro_online) values (${A}, 'mercadopago', 'Mercado Pago', true)
    `)
    await crearMedioPago(A, { slug: "destacado", nombre: "Destacado" })
    await actualizarMedioPago(A, "destacado", { destacarEnCatalogo: true })
    await crearMedioPago(A, { slug: "ficha", nombre: "Ficha" })
    await actualizarMedioPago(A, "ficha", { mostrarEnFicha: true })
    await crearMedioPago(A, { slug: "retiro", nombre: "Solo retiro", aplicaEnvio: false })

    expect(await actualizarMedioPago(A, "mercadopago", { audiencia: "cuenta_corriente" })).toMatchObject({
      kind: "invalid",
      campo: "audiencia",
      error: "Un medio de cobro en línea no puede ser solo para cuentas corrientes.",
    })
    for (const slug of ["destacado", "ficha"]) {
      expect(await actualizarMedioPago(A, slug, { audiencia: "cuenta_corriente" })).toMatchObject({
        kind: "invalid",
        error: "El medio solo para cuentas corrientes no puede destacarse en el catálogo ni mostrarse en la ficha. Quite esas opciones primero.",
      })
    }
    expect(await actualizarMedioPago(A, "retiro", { audiencia: "cuenta_corriente" })).toMatchObject({
      kind: "invalid",
      campo: "aplicaRetiro",
    })
    // Ya marcado, tampoco se lo puede destacar ni sacar de una modalidad.
    await crearMedioPago(A, { slug: "cc", nombre: "CC", audiencia: "cuenta_corriente" })
    expect(await actualizarMedioPago(A, "cc", { destacarEnCatalogo: true })).toMatchObject({ kind: "invalid" })
    expect(await actualizarMedioPago(A, "cc", { aplicaEnvio: false })).toMatchObject({ kind: "invalid", campo: "aplicaRetiro" })
    expect(await actualizarMedioPago(A, "cc", { activo: false })).toMatchObject({ kind: "ok" })
  })

  it("otro tenant puede tener su propio medio de cuenta corriente", async () => {
    await crearMedioPago(A, { slug: "cc", nombre: "CC", audiencia: "cuenta_corriente" })
    const r = await crearMedioPago(B, { slug: "cc", nombre: "CC", audiencia: "cuenta_corriente" })
    expect(r).toMatchObject({ kind: "ok" })
  })
})
