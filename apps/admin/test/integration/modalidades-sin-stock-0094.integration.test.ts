import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"
import { seedTenant, truncateAll } from "./helpers"
import {
  actualizarModalidad,
  borrarModalidad,
  crearModalidad,
  listarModalidades,
  modalidadPropia,
} from "@/lib/modalidades-sin-stock-repo"

/**
 * Migración 0094 (modalidades de venta sin stock) contra la base real de test: tabla, CHECK,
 * UNIQUE por tenant, `ON DELETE SET NULL` de la columna del overlay y los GRANT a `shop_app`.
 * Datos inventados.
 */

const MIGRACION_0094 = fileURLToPath(new URL("../../drizzle/0094_modalidades_sin_stock.sql", import.meta.url))

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

describe("0094: GRANT a shop_app (el Shop lee las modalidades y la columna del overlay)", () => {
  let pg: postgres.Sql
  let rolCreadoAca = false

  async function comoShopApp(stmt: string): Promise<{ ok: true } | { ok: false; code: string }> {
    let r: { ok: true } | { ok: false; code: string } | null = null
    const ROLLBACK = new Error("rollback")
    try {
      await pg.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        try {
          await tx.unsafe(stmt)
          r = { ok: true }
        } catch (e) {
          r = { ok: false, code: (e as { code?: string }).code ?? "?" }
        }
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    if (!r) throw new Error("comoShopApp: sin resultado")
    return r
  }

  const bloque = (archivo: string) => {
    const partes = readFileSync(archivo, "utf8").split("--> statement-breakpoint")
    const b = partes[partes.length - 1]
    if (!/DO \$\$/.test(b)) throw new Error(`${archivo}: no encontré el bloque DO $$ de los GRANTs`)
    return b
  }

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    pg = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await pg`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      // Sin el rol el bloque condicional no concede nada y NO falla (como al migrar crm_test).
      await pg.unsafe(bloque(MIGRACION_0094))
      await pg.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    // Idempotente: es el bloque que se corre a mano si el rol se creó después de migrar.
    await pg.unsafe(bloque(MIGRACION_0094))
  })
  afterAll(async () => {
    if (!pg) return
    if (rolCreadoAca) {
      await pg.unsafe("DROP OWNED BY shop_app")
      await pg.unsafe("DROP ROLE shop_app")
    }
    await pg.end()
  })

  it("shop_app lee modalidades_sin_stock (las columnas que lee el Shop)", async () => {
    expect(
      await comoShopApp(
        `SELECT "id", "tenant_id", "nombre", "texto", "plazo_dias", "flujo", "activa" FROM public.modalidades_sin_stock`,
      ),
    ).toEqual({ ok: true })
  })

  it("shop_app lee catalog_overlay.modalidad_sin_stock_id (GRANT por columna)", async () => {
    expect(await comoShopApp(`SELECT "modalidad_sin_stock_id" FROM public.catalog_overlay`)).toEqual({ ok: true })
  })

  it("shop_app no escribe modalidades", async () => {
    expect(await comoShopApp(`UPDATE public.modalidades_sin_stock SET "activa" = false`)).toEqual({ ok: false, code: "42501" })
    expect(
      await comoShopApp(
        `INSERT INTO public.modalidades_sin_stock (tenant_id, nombre, texto, flujo) VALUES ('tenant-a', 'X', 'X', 'en_linea')`,
      ),
    ).toEqual({ ok: false, code: "42501" })
  })
})

describe("repo de modalidades", () => {
  const datos = { nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true }

  it("crea, lista por nombre y aísla por tenant", async () => {
    const r = await crearModalidad(A, datos)
    expect(r).toMatchObject({ kind: "ok", modalidad: { nombre: "Modalidad 48 h", plazoDias: 2, flujo: "en_linea", activa: true } })
    await crearModalidad(A, { ...datos, nombre: "A pedido", plazoDias: null, flujo: "a_confirmar" })
    await crearModalidad(B, { ...datos, nombre: "Ajena" })
    expect((await listarModalidades(A)).map((m) => m.nombre)).toEqual(["A pedido", "Modalidad 48 h"])
    expect((await listarModalidades(B)).map((m) => m.nombre)).toEqual(["Ajena"])
  })

  it("un nombre duplicado en el tenant es invalid/nombre; en otro tenant se admite", async () => {
    await crearModalidad(A, datos)
    expect(await crearModalidad(A, datos)).toEqual({ kind: "invalid", campo: "nombre", error: "Ya existe una modalidad con ese nombre." })
    expect((await crearModalidad(B, datos)).kind).toBe("ok")
  })

  it("actualiza (mueve updated_at), detecta el duplicado y no toca ids ajenos", async () => {
    const a = await crearModalidad(A, datos)
    const b = await crearModalidad(A, { ...datos, nombre: "Otra" })
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("setup")
    const antes = await getDb().execute(sql`select updated_at from modalidades_sin_stock where id = ${a.modalidad.id}`)
    const upd = await actualizarModalidad(A, a.modalidad.id, { ...datos, texto: "Nuevo", activa: false })
    expect(upd).toMatchObject({ kind: "ok", modalidad: { texto: "Nuevo", activa: false } })
    const despues = await getDb().execute(sql`select updated_at from modalidades_sin_stock where id = ${a.modalidad.id}`)
    expect(new Date(despues[0].updated_at as string).getTime()).toBeGreaterThan(new Date(antes[0].updated_at as string).getTime())
    expect(await actualizarModalidad(A, b.modalidad.id, datos)).toMatchObject({ kind: "invalid", campo: "nombre" })
    expect(await actualizarModalidad(B, a.modalidad.id, datos)).toEqual({ kind: "not_found" })
    expect(await actualizarModalidad(A, "no-uuid", datos)).toEqual({ kind: "not_found" })
  })

  it("modalidadPropia y borrar respetan el tenant; borrar deja el overlay en NULL", async () => {
    const a = await crearModalidad(A, datos)
    if (a.kind !== "ok") throw new Error("setup")
    const id = a.modalidad.id
    expect(await modalidadPropia(A, id)).toBe(true)
    expect(await modalidadPropia(B, id)).toBe(false)
    expect(await modalidadPropia(A, "no-uuid")).toBe(false)
    await getDb().execute(sql`insert into catalog_overlay (tenant_id, alegra_id, modalidad_sin_stock_id) values (${A}, 'item-2', ${id})`)
    expect(await borrarModalidad(B, id)).toEqual({ kind: "not_found" })
    expect(await borrarModalidad(A, id)).toEqual({ kind: "ok" })
    expect(await borrarModalidad(A, id)).toEqual({ kind: "not_found" })
    const f = await getDb().execute(sql`select modalidad_sin_stock_id from catalog_overlay where alegra_id = 'item-2'`)
    expect((f[0] as { modalidad_sin_stock_id: string | null }).modalidad_sin_stock_id).toBeNull()
  })
})
