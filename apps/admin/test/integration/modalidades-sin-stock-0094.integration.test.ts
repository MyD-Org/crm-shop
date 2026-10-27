import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0094 (modalidades de venta sin stock) contra la base real de test: tabla, CHECK,
 * UNIQUE por tenant y `ON DELETE SET NULL` de la columna del overlay. Datos inventados.
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

type Datos = { nombre: string; texto: string; plazo_dias: number | null; flujo: string }

const insertar = (d: Datos, tenant = A) =>
  getDb().execute(
    sql`insert into modalidades_sin_stock (tenant_id, nombre, texto, plazo_dias, flujo)
        values (${tenant}, ${d.nombre}, ${d.texto}, ${d.plazo_dias}, ${d.flujo}) returning id`,
  )

/** drizzle envuelve el error del driver: el código y el constraint están en `.cause`. */
async function falla(p: Promise<unknown>): Promise<{ code: string | null; constraint: string | null }> {
  try {
    await p
  } catch (e) {
    for (let x: unknown = e, i = 0; x && i < 3; x = (x as { cause?: unknown }).cause, i++) {
      const c = (x as { code?: unknown }).code
      if (typeof c === "string") {
        const n = (x as { constraint_name?: unknown }).constraint_name
        return { code: c, constraint: typeof n === "string" ? n : null }
      }
    }
  }
  return { code: null, constraint: null }
}

describe("0094 modalidades_sin_stock", () => {
  it("crea la tabla con sus CHECK y el UNIQUE por tenant", async () => {
    await insertar({ nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazo_dias: 2, flujo: "en_linea" })
    expect(await falla(insertar({ nombre: "Modalidad 48 h", texto: "Otro", plazo_dias: null, flujo: "a_confirmar" }))).toEqual({
      code: "23505",
      constraint: "modalidades_sin_stock_tenant_nombre_uniq",
    })
    const plazo = { code: "23514", constraint: "modalidades_sin_stock_plazo_dias_check" }
    const flujo = { code: "23514", constraint: "modalidades_sin_stock_flujo_check" }
    const texto = { code: "23514", constraint: "modalidades_sin_stock_texto_check" }
    expect(await falla(insertar({ nombre: "X", texto: "X", plazo_dias: 0, flujo: "en_linea" }))).toEqual(plazo)
    expect(await falla(insertar({ nombre: "X2", texto: "X", plazo_dias: 61, flujo: "en_linea" }))).toEqual(plazo)
    expect(await falla(insertar({ nombre: "Y", texto: "Y", plazo_dias: null, flujo: "otro" }))).toEqual(flujo)
    expect(await falla(insertar({ nombre: "Z", texto: "", plazo_dias: null, flujo: "en_linea" }))).toEqual(texto)
    expect(await falla(insertar({ nombre: "W", texto: "x".repeat(41), plazo_dias: null, flujo: "en_linea" }))).toEqual(texto)
  })

  it("el mismo nombre se admite en otro tenant y activa arranca en true", async () => {
    await insertar({ nombre: "A pedido", texto: "A pedido", plazo_dias: null, flujo: "a_confirmar" })
    await insertar({ nombre: "A pedido", texto: "A pedido", plazo_dias: null, flujo: "a_confirmar" }, B)
    const filas = await getDb().execute(sql`select activa from modalidades_sin_stock where tenant_id = ${A}`)
    expect(filas[0]?.activa).toBe(true)
  })

  it("borrar la modalidad deja el overlay en NULL", async () => {
    const r = await insertar({ nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazo_dias: 2, flujo: "en_linea" })
    const id = (r[0] as { id: string }).id
    await getDb().execute(
      sql`insert into catalog_overlay (tenant_id, alegra_id, modalidad_sin_stock_id) values (${A}, 'item-1', ${id})`,
    )
    await getDb().execute(sql`delete from modalidades_sin_stock where id = ${id}`)
    const filas = await getDb().execute(sql`select modalidad_sin_stock_id from catalog_overlay where alegra_id = 'item-1'`)
    expect(filas).toHaveLength(1)
    expect((filas[0] as { modalidad_sin_stock_id: string | null }).modalidad_sin_stock_id).toBeNull()
  })
})
