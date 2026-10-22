import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { guardarDespacho, guardarEnvio, leerDespacho, leerEnvio } from "@/lib/reglas-venta-repo"
import { DESPACHO_DEFAULT } from "@/lib/despacho-validacion"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0093 (plazo de despacho) contra la base real de test: defaults, el CHECK de
 * `despacho_dias_habiles` y el repo (upsert que no pisa el envío ni las otras reglas). Datos
 * inventados.
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

const insertarFila = (tenant: string) => getDb().execute(sql`insert into reglas_venta (tenant_id) values (${tenant}) on conflict do nothing`)

describe("0093: defaults y CHECK", () => {
  it("una fila nueva (o previa a la migración) queda visible con 1 día hábil", async () => {
    await insertarFila(A)
    expect(await leerDespacho(A)).toEqual(DESPACHO_DEFAULT)
  })

  it("sin fila, leerDespacho devuelve el default", async () => {
    expect(await leerDespacho(B)).toEqual(DESPACHO_DEFAULT)
  })

  it("los días fuera de 1..30 violan el CHECK", async () => {
    await insertarFila(A)
    await expect(getDb().execute(sql`update reglas_venta set despacho_dias_habiles = 0 where tenant_id = ${A}`)).rejects.toThrow()
    await expect(getDb().execute(sql`update reglas_venta set despacho_dias_habiles = 31 where tenant_id = ${A}`)).rejects.toThrow()
    await getDb().execute(sql`update reglas_venta set despacho_dias_habiles = 30 where tenant_id = ${A}`)
    expect((await leerDespacho(A)).diasHabiles).toBe(30)
  })
})

describe("guardarDespacho", () => {
  it("crea la fila si no existe y no toca la configuración de envío", async () => {
    await guardarEnvio(A, { domicilioActivo: false, gratisActivo: false })
    const r = await guardarDespacho(A, { visible: false, diasHabiles: 3 })
    expect(r).toEqual({ kind: "ok", despacho: { visible: false, diasHabiles: 3 } })
    expect(await leerDespacho(A)).toEqual({ visible: false, diasHabiles: 3 })
    expect((await leerEnvio(A)).domicilioActivo).toBe(false)
  })

  it("guardar el envío no pisa el plazo de despacho", async () => {
    await guardarDespacho(A, { visible: true, diasHabiles: 4 })
    await guardarEnvio(A, { domicilioActivo: true, gratisActivo: false })
    expect(await leerDespacho(A)).toEqual({ visible: true, diasHabiles: 4 })
  })

  it("es por tenant", async () => {
    await guardarDespacho(A, { visible: false, diasHabiles: 2 })
    expect(await leerDespacho(B)).toEqual(DESPACHO_DEFAULT)
  })

  it("un cuerpo inválido no escribe", async () => {
    const r = await guardarDespacho(A, { visible: true, diasHabiles: 99 })
    expect(r).toMatchObject({ kind: "invalid", campo: "diasHabiles" })
    const filas = await getDb().execute(sql`select 1 from reglas_venta where tenant_id = ${A}`)
    expect(filas).toHaveLength(0)
  })
})
