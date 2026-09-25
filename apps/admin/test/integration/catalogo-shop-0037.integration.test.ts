import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import type { AlegraProduct } from "@/lib/alegra"
import { sumaImpuestos } from "@/lib/alegra-impuestos"
import { upsertProductos } from "@/lib/catalog-products-repo"
import vector from "@/lib/__fixtures__/impuestos-alegra.json"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0037 (change `catalogo-shop-desde-crm`, PR-1a), contra Postgres real (crm_test):
 *  (a) la regla de impuestos es la misma en TS (sumaImpuestos), en SQL (alegra_suma_impuestos) y
 *      en lo que persiste upsertProductos: el vector compartido se evalúa en los tres;
 *  (b) el backfill `backfill-iva` (leído del .sql) suma lo guardado con "el mayor" y sólo toca lo
 *      que cambia;
 *  (c) precios_alegra es generada: raw NULL → [], se recalcula al cambiar raw, el upsert no falla;
 *  (d) catalog_categories_shop.activo refleja status;
 *  (e) shop_app no puede ejecutar la función.
 * Datos inventados: tenant `tenant-0037`, ítems de fantasía.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0037_catalogo_shop_desde_crm.sql", import.meta.url))
const TENANT = "tenant-0037"

type Caso = { caso: string; tax?: unknown; esperado: string | null }
const CASOS = vector as Caso[]

function statementDe(marcador: RegExp): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const encontradas = partes.filter((p) => marcador.test(p))
  if (encontradas.length !== 1) throw new Error(`0037: esperaba un statement que matchee ${marcador}`)
  return encontradas[0]
}

let sql: postgres.Sql
let rolCreadoAca = false

const item = (alegraId: string, raw: Record<string, unknown> | null, extra: Partial<AlegraProduct> = {}): AlegraProduct => ({
  alegraId,
  code: `REF-${alegraId}`,
  name: `Producto ${alegraId}`,
  description: null,
  categoryAlegraId: null,
  prices: [],
  stock: 1,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: sumaImpuestos(raw?.tax),
  raw: raw as Record<string, unknown>,
  ...extra,
})

beforeAll(async () => {
  assertLocalTestDb(TEST_DATABASE_URL)
  sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
})

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
})

afterAll(async () => {
  await truncateAll()
  if (!sql) return
  if (rolCreadoAca) {
    await sql.unsafe("DROP OWNED BY shop_app")
    await sql.unsafe("DROP ROLE shop_app")
  }
  await sql.end()
})

describe("0037 (a): TS = SQL = persistido, con el vector compartido", () => {
  it.each(CASOS.map((c) => [c.caso, c] as const))("%s", async (_nombre, c) => {
    const tax = c.tax === undefined ? null : JSON.stringify(c.tax)
    const [r] = await sql.unsafe("SELECT public.alegra_suma_impuestos($1::text::jsonb)::numeric(5,2)::text AS v", [tax])
    expect(r.v).toBe(c.esperado)

    const ts = sumaImpuestos(c.tax)
    expect(ts === null ? null : ts.toFixed(2)).toBe(c.esperado)

    const raw: Record<string, unknown> = c.tax === undefined ? { id: "1" } : { id: "1", tax: c.tax }
    await upsertProductos(TENANT, [item("1", raw)], { leidoAt: new Date(), leidoPor: "sync" })
    const [fila] = await sql`
      SELECT iva_porcentaje::text AS v FROM catalog_products WHERE tenant_id = ${TENANT} AND alegra_id = '1'
    `
    expect(fila.v).toBe(c.esperado)
  })
})

describe("0037 (b): backfill-iva", () => {
  it("suma lo guardado con 'el mayor', no toca raw NULL ni lo ya correcto", async () => {
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, raw, iva_porcentaje)
      VALUES (${TENANT}, 'dos', 'Dos impuestos', '{"tax":[{"percentage":21},{"percentage":3}]}'::jsonb, 21),
             (${TENANT}, 'sin-raw', 'Sin raw', NULL, 21),
             (${TENANT}, 'ok', 'Ya correcto', '{"tax":[{"percentage":21}]}'::jsonb, 21)
    `
    const r = await sql.unsafe(statementDe(/-- backfill-iva/))
    expect(r.count).toBe(1)
    const filas = await sql`
      SELECT alegra_id, iva_porcentaje::text AS v FROM catalog_products WHERE tenant_id = ${TENANT} ORDER BY alegra_id
    `
    expect(filas.map((f) => [f.alegra_id, f.v])).toEqual([
      ["dos", "24.00"],
      ["ok", "21.00"],
      ["sin-raw", "21.00"],
    ])
    // Idempotente: una segunda corrida no toca nada.
    expect((await sql.unsafe(statementDe(/-- backfill-iva/))).count).toBe(0)
  })
})

describe("0037 (c): precios_alegra generada", () => {
  it("raw NULL → [], cambiar raw la recalcula, y upsertProductos no la escribe", async () => {
    await upsertProductos(TENANT, [item("p", null)], { leidoAt: new Date(), leidoPor: "sync" })
    const leer = async () =>
      (await sql`SELECT precios_alegra FROM catalog_products WHERE tenant_id = ${TENANT} AND alegra_id = 'p'`)[0]
        .precios_alegra
    expect(await leer()).toEqual([])

    await sql`UPDATE catalog_products SET raw = '{"price":[{"idPriceList":1,"price":100}]}'::jsonb
              WHERE tenant_id = ${TENANT} AND alegra_id = 'p'`
    expect(await leer()).toEqual([{ idPriceList: 1, price: 100 }])

    const precios = [{ idPriceList: 2, price: 50 }]
    await upsertProductos(TENANT, [item("p", { price: precios })], { leidoAt: new Date(), leidoPor: "webhook" })
    expect(await leer()).toEqual(precios)
    const [vista] = await sql`SELECT precios_alegra FROM public.catalog_products_shop WHERE tenant_id = ${TENANT} AND alegra_id = 'p'`
    expect(vista.precios_alegra).toEqual(precios)
  })
})

describe("0037 (d): catalog_categories_shop", () => {
  it("activo = (status = 'active')", async () => {
    await sql`
      INSERT INTO catalog_categories (tenant_id, alegra_id, name, status)
      VALUES (${TENANT}, 'c1', 'Activa', 'active'), (${TENANT}, 'c2', 'Dada de baja', 'inactive')
    `
    const filas = await sql`
      SELECT alegra_id, activo FROM public.catalog_categories_shop WHERE tenant_id = ${TENANT} ORDER BY alegra_id
    `
    expect(filas.map((f) => [f.alegra_id, f.activo])).toEqual([
      ["c1", true],
      ["c2", false],
    ])
  })
})

describe("0037 (e): la función no es de shop_app", () => {
  it("SELECT alegra_suma_impuestos como shop_app → 42501", async () => {
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    // Con el bloque de GRANTs aplicado, shop_app tiene USAGE sobre public: el 42501 es de la función.
    const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
    await sql.unsafe(partes[partes.length - 1])

    let code: string | undefined
    const ROLLBACK = new Error("rollback")
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        await tx.unsafe("SELECT 1 FROM public.catalog_products_shop LIMIT 1")
        try {
          await tx.unsafe("SELECT public.alegra_suma_impuestos('[]'::jsonb)")
        } catch (e) {
          code = (e as { code?: string }).code
        }
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    expect(code).toBe("42501")
  })
})
