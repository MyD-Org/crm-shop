import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0068 (change `listas-cuenta-corriente`, rebanada A): ANTI-FUGA de los precios de las
 * listas privadas. shop_app los lee SOLO por la vista `catalog_products_shop_privados` (4 columnas)
 * y el enlace SOLO por `lista_precio_alegra_mapeo_shop`; nada por la tabla `catalog_products` (ni
 * por la columna), ni por `listas_precio_online`, ni por el enlace crudo. La vista pública
 * `catalog_products_shop` no los emite en `precios_alegra`.
 *
 * Mismo patrón que catalog-products-shop-grants: el rol `shop_app` lo crea el global-setup (NOLOGIN)
 * y la plantilla se migró sin él (el bloque condicional no concedió nada). Acá se corre el MISMO
 * bloque de GRANTs leído del .sql y se verifica como `shop_app`. Datos inventados.
 */

const MIGRACION_0035 = fileURLToPath(new URL("../../drizzle/0035_catalog_products_shop.sql", import.meta.url))
const MIGRACION_0037 = fileURLToPath(new URL("../../drizzle/0037_catalogo_shop_desde_crm.sql", import.meta.url))
const MIGRACION_0065 = fileURLToPath(new URL("../../drizzle/0065_shop_precios_online.sql", import.meta.url))
const MIGRACION_0068 = fileURLToPath(new URL("../../drizzle/0068_listas_privadas.sql", import.meta.url))

/** El bloque de GRANTs tal cual está en la migración (último statement). */
function bloqueDeGrants(archivo: string): string {
  const partes = readFileSync(archivo, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error(`${archivo}: no encontré el bloque DO $$ de los GRANTs`)
  return bloque
}

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: number } | { ok: false; code: string }

/** Corre `stmt` como `shop_app` en una transacción que SIEMPRE se revierte. */
async function comoShopApp(stmt: string): Promise<Resultado> {
  let resultado: Resultado | null = null
  const ROLLBACK = new Error("rollback")
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE shop_app")
      try {
        const filas = await tx.unsafe(stmt)
        resultado = { ok: true, filas: filas.count ?? filas.length }
      } catch (e) {
        resultado = { ok: false, code: (e as { code?: string }).code ?? "?" }
      }
      throw ROLLBACK
    })
  } catch (e) {
    if (e !== ROLLBACK) throw e
  }
  if (!resultado) throw new Error("comoShopApp: sin resultado")
  return resultado
}

const SIN_PERMISO = { ok: false, code: "42501" }
const T = "tenant-grants-lp"

async function limpiar() {
  await sql`DELETE FROM lista_precio_alegra_mapeo WHERE tenant_id = ${T}`
  await sql`DELETE FROM listas_precio_online WHERE tenant_id = ${T}`
  await sql`DELETE FROM catalog_products WHERE tenant_id = ${T}`
  await sql`DELETE FROM tenants WHERE id = ${T}`
}

describe("migración 0068: shop_app y las listas privadas (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    // Los bloques corren en el orden de las migraciones, como en una base migrada con el rol ya creado.
    for (const m of [MIGRACION_0035, MIGRACION_0037, MIGRACION_0065, MIGRACION_0068]) await sql.unsafe(bloqueDeGrants(m))

    await limpiar()
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant LP', '/logos/test.svg', 'no-responder@plataforma.example')`
    const [pub] = await sql`
      INSERT INTO listas_precio_online (tenant_id, nombre, coeficiente, es_referencia) VALUES (${T}, 'Lista A', 1.6, true) RETURNING id
    `
    const [priv] = await sql`
      INSERT INTO listas_precio_online (tenant_id, nombre, coeficiente, privada) VALUES (${T}, 'Lista L5', 1.2, true) RETURNING id
    `
    await sql`
      INSERT INTO lista_precio_alegra_mapeo (tenant_id, alegra_account, alegra_price_list_id, lista_id)
      VALUES (${T}, 'principal', '5', ${priv.id})
    `
    const publicos = sql.json([{ idPriceList: pub.id, name: "Lista A", price: 160, main: true }])
    const privados = sql.json([{ idPriceList: priv.id, name: "Lista L5", price: 120 }])
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, status, alegra_status, precios_online, precios_online_privados)
      VALUES (${T}, '1', 'Ítem activo', 'active', 'active', ${publicos}, ${privados}),
             (${T}, '2', 'Ítem inactivo', 'active', 'inactive', ${publicos}, ${privados})
    `
  })

  afterAll(async () => {
    if (!sql) return
    await limpiar()
    if (rolCreadoAca) {
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  it("la vista privada expone exactamente 4 columnas, en orden", async () => {
    const cols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop_privados' ORDER BY ordinal_position
    `
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual([
      ["tenant_id", "text"],
      ["alegra_id", "text"],
      ["lista_id", "uuid"],
      ["precio", "numeric"],
    ])
  })

  it("la vista del enlace expone exactamente 4 columnas, en orden", async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'lista_precio_alegra_mapeo_shop' ORDER BY ordinal_position
    `
    expect(cols.map((c) => c.column_name)).toEqual(["tenant_id", "alegra_account", "alegra_price_list_id", "lista_id"])
  })

  it("shop_app lee los precios privados por la vista, solo de ítems activos", async () => {
    expect(
      await comoShopApp(`SELECT tenant_id, alegra_id, lista_id, precio FROM public.catalog_products_shop_privados WHERE tenant_id = '${T}'`),
    ).toEqual({ ok: true, filas: 1 })
    const filas = await sql`SELECT alegra_id, precio FROM public.catalog_products_shop_privados WHERE tenant_id = ${T}`
    expect(filas.map((f) => [f.alegra_id, Number(f.precio)])).toEqual([["1", 120]])
  })

  it("shop_app lee el enlace por su vista", async () => {
    expect(
      await comoShopApp(
        `SELECT tenant_id, alegra_account, alegra_price_list_id, lista_id FROM public.lista_precio_alegra_mapeo_shop WHERE tenant_id = '${T}'`,
      ),
    ).toEqual({ ok: true, filas: 1 })
  })

  it("la vista pública NO emite ninguna lista privada en precios_alegra", async () => {
    const filas = await sql`SELECT alegra_id, precios_alegra FROM public.catalog_products_shop WHERE tenant_id = ${T} ORDER BY alegra_id`
    expect(filas).toHaveLength(2)
    for (const f of filas) {
      expect(f.precios_alegra).toHaveLength(1)
      expect(f.precios_alegra[0].name).toBe("Lista A")
      expect(JSON.stringify(f.precios_alegra)).not.toContain("Lista L5")
    }
  })

  it("la vista pública conserva sus 12 columnas: ninguna 'privad*'", async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop'
    `
    expect(cols).toHaveLength(12)
    expect(cols.filter((c) => /privad/.test(c.column_name))).toHaveLength(0)
  })

  it.each([
    "SELECT precios_online_privados FROM public.catalog_products",
    "SELECT 1 FROM public.catalog_products LIMIT 1",
    "SELECT precios_online FROM public.catalog_products",
    "SELECT 1 FROM public.listas_precio_online LIMIT 1",
    "SELECT coeficiente FROM public.listas_precio_online",
    "SELECT 1 FROM public.lista_precio_alegra_mapeo LIMIT 1",
    "SELECT 1 FROM public.lista_precio_overrides LIMIT 1",
    "SELECT 1 FROM public.precios_online_cambios LIMIT 1",
  ])("sin permiso sobre las tablas base: %s", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
  })

  it.each([
    "SELECT precios_online_privados FROM public.catalog_products_shop",
    "SELECT costo FROM public.catalog_products_shop_privados",
    "SELECT coeficiente FROM public.lista_precio_alegra_mapeo_shop",
    "SELECT privada FROM public.lista_precio_alegra_mapeo_shop",
  ])("las vistas no tienen más columnas que las del contrato: %s", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual({ ok: false, code: "42703" })
  })

  it.each([
    "UPDATE public.catalog_products_shop_privados SET precio = 1",
    "INSERT INTO public.catalog_products_shop_privados (tenant_id, alegra_id) VALUES ('x', '1')",
    "DELETE FROM public.catalog_products_shop_privados",
    "UPDATE public.lista_precio_alegra_mapeo_shop SET lista_id = lista_id",
    "DELETE FROM public.lista_precio_alegra_mapeo_shop",
  ])("las vistas son de solo lectura: %s", async (stmt) => {
    // 42501 (sin permiso) o 55000 (vista no actualizable, por el JOIN): en los dos casos no escribe.
    const r = await comoShopApp(stmt)
    expect(r.ok).toBe(false)
    expect(["42501", "55000"]).toContain((r as { code: string }).code)
  })

  it("el bloque de GRANTs de 0068 es idempotente", async () => {
    await expect(sql.unsafe(bloqueDeGrants(MIGRACION_0068))).resolves.toBeDefined()
  })
})
