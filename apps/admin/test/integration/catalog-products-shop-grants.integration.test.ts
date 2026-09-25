import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0035 (change `webhooks-stock-alegra`, rebanada 2): vista angosta
 * `public.catalog_products_shop` para que el Shop lea stock, precios y estado del espejo de
 * productos del CRM, con SELECT para `shop_app` y nada sobre la tabla base.
 *
 * Mismo patrón que shop-cuenta-corriente-grants: en la base de test el rol no existe cuando el
 * global-setup migra; este test crea el rol (NOLOGIN, sólo en el Postgres LOCAL), corre el MISMO
 * bloque de GRANTs leído del .sql y verifica como `shop_app`. Si creó el rol, lo borra al final.
 *
 * Migración 0037 (change `catalogo-shop-desde-crm`): la vista suma 6 columnas AL FINAL (12 en
 * total) y aparece `catalog_categories_shop` (5). Su bloque de GRANTs concede las dos vistas y
 * nada sobre las tablas; se corre después del de 0035, igual que en una base migrada.
 *
 * Migración 0038: registra el SELECT de `shop_app` sobre las TABLAS del overlay
 * (`catalog_overlay` y `shop_categories`), que en prod se había dado a mano. Sólo lectura.
 *
 * Datos inventados: tenant `tenant-cps`, ítems de fantasía, dominio `.example`.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0035_catalog_products_shop.sql", import.meta.url))
const MIGRACION_0037 = fileURLToPath(new URL("../../drizzle/0037_catalogo_shop_desde_crm.sql", import.meta.url))
const MIGRACION_0038 = fileURLToPath(new URL("../../drizzle/0038_grants_overlay_shop.sql", import.meta.url))

/** El bloque de GRANTs tal cual está en la migración (último statement). */
function bloqueDeGrants(archivo = MIGRACION): string {
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

async function limpiar() {
  await sql`DELETE FROM catalog_overlay WHERE tenant_id = 'tenant-cps'`
  await sql`DELETE FROM shop_categories WHERE tenant_id = 'tenant-cps'`
  await sql`DELETE FROM catalog_products WHERE tenant_id = 'tenant-cps'`
  await sql`DELETE FROM catalog_categories WHERE tenant_id = 'tenant-cps'`
  await sql`DELETE FROM tenants WHERE id = 'tenant-cps'`
}

describe("migraciones 0035, 0037 y 0038: lo que shop_app lee del catálogo (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      // Sin el rol, el bloque condicional no concede nada y no falla (como en crm_test al migrar).
      await sql.unsafe(bloqueDeGrants())
      await sql.unsafe(bloqueDeGrants(MIGRACION_0037))
      await sql.unsafe(bloqueDeGrants(MIGRACION_0038))
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())
    await sql.unsafe(bloqueDeGrants(MIGRACION_0037))
    await sql.unsafe(bloqueDeGrants(MIGRACION_0038))

    await limpiar()
    await sql`
      INSERT INTO tenants (id, name, logo_path, resend_from)
      VALUES ('tenant-cps', 'Tenant CPS', '/logos/test.svg', 'no-responder@plataforma.example')
    `
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, raw,
                                    alegra_leido_at, leido_por)
      VALUES
        ('tenant-cps', '1', 'Ítem activo', 8, 'active', 'active',
         '{"price":[{"idPriceList":"1","name":"General","price":100}],"inventory":{"unitCost":1}}'::jsonb,
         '2026-09-24T12:00:00Z', 'webhook'),
        ('tenant-cps', '2', 'Ítem sin raw', NULL, 'active', NULL, NULL, NULL, NULL),
        ('tenant-cps', '3', 'Ítem que no vino en la sync', 5, 'inactive', 'active', '{}'::jsonb, NULL, NULL),
        ('tenant-cps', '4', 'Ítem inactivo en Alegra', 5, 'active', 'inactive', '{}'::jsonb, NULL, NULL)
    `
    await sql`
      INSERT INTO catalog_categories (tenant_id, alegra_id, name, parent_alegra_id, status)
      VALUES ('tenant-cps', 'c1', 'Categoría raíz', NULL, 'active'),
             ('tenant-cps', 'c2', 'Categoría dada de baja', 'c1', 'inactive')
    `
    const [cat] = await sql`
      INSERT INTO shop_categories (tenant_id, nombre, slug)
      VALUES ('tenant-cps', 'Lámparas', 'lamparas')
      RETURNING id
    `
    await sql`
      INSERT INTO catalog_overlay (tenant_id, alegra_id, visible, nombre, categoria_id)
      VALUES ('tenant-cps', '1', true, 'Ítem publicado', ${cat.id}),
             ('tenant-cps', '2', false, NULL, NULL)
    `
  })

  afterAll(async () => {
    if (!sql) return
    await limpiar()
    if (rolCreadoAca) {
      // DROP OWNED revoca lo concedido en ESTA base (el rol recién creado no tiene nada en otras).
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  it("la vista tiene exactamente las 12 columnas del contrato, en orden (sin raw ni imágenes)", async () => {
    const cols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop'
      ORDER BY ordinal_position
    `
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual([
      ["tenant_id", "text"],
      ["alegra_id", "text"],
      ["stock", "numeric"],
      ["precios_alegra", "jsonb"],
      ["activo", "boolean"],
      ["alegra_leido_at", "timestamp with time zone"],
      ["name", "text"],
      ["description", "text"],
      ["code", "text"],
      ["brand", "text"],
      ["category_alegra_id", "text"],
      ["iva_porcentaje", "numeric"],
    ])
  })

  it("catalog_categories_shop tiene exactamente 5 columnas, en orden", async () => {
    const cols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_categories_shop'
      ORDER BY ordinal_position
    `
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual([
      ["tenant_id", "text"],
      ["alegra_id", "text"],
      ["name", "text"],
      ["parent_alegra_id", "text"],
      ["activo", "boolean"],
    ])
  })

  it("precios_alegra = raw->'price' (o []) y activo combina status con alegra_status", async () => {
    const filas = await sql`
      SELECT alegra_id, stock, precios_alegra, activo, alegra_leido_at
      FROM public.catalog_products_shop WHERE tenant_id = 'tenant-cps' ORDER BY alegra_id
    `
    expect(
      filas.map((f) => ({
        id: f.alegra_id,
        stock: f.stock,
        precios: f.precios_alegra,
        activo: f.activo,
        leido: f.alegra_leido_at ? new Date(f.alegra_leido_at).toISOString() : null,
      })),
    ).toEqual([
      {
        id: "1",
        stock: "8",
        precios: [{ idPriceList: "1", name: "General", price: 100 }],
        activo: true,
        leido: "2026-09-24T12:00:00.000Z",
      },
      { id: "2", stock: null, precios: [], activo: true, leido: null },
      { id: "3", stock: "5", precios: [], activo: false, leido: null },
      { id: "4", stock: "5", precios: [], activo: false, leido: null },
    ])
  })

  it("shop_app lee la vista", async () => {
    expect(
      await comoShopApp(
        "SELECT tenant_id, alegra_id, stock, precios_alegra, activo, alegra_leido_at FROM public.catalog_products_shop WHERE tenant_id = 'tenant-cps'",
      ),
    ).toEqual({ ok: true, filas: 4 })
  })

  it("shop_app lee las columnas nuevas y la vista de categorías", async () => {
    expect(
      await comoShopApp(
        "SELECT name, description, code, brand, category_alegra_id, iva_porcentaje FROM public.catalog_products_shop WHERE tenant_id = 'tenant-cps'",
      ),
    ).toEqual({ ok: true, filas: 4 })
    expect(
      await comoShopApp(
        "SELECT tenant_id, alegra_id, name, parent_alegra_id, activo FROM public.catalog_categories_shop WHERE tenant_id = 'tenant-cps'",
      ),
    ).toEqual({ ok: true, filas: 2 })
  })

  it("0038: shop_app lee el overlay y las categorías de la tienda (las columnas de crm.ts)", async () => {
    expect(
      await comoShopApp(
        "SELECT id, tenant_id, alegra_id, visible, nombre, categoria_id, fotos FROM public.catalog_overlay WHERE tenant_id = 'tenant-cps'",
      ),
    ).toEqual({ ok: true, filas: 2 })
    expect(
      await comoShopApp(
        "SELECT id, tenant_id, parent_id, nombre, orden, nivel, activa FROM public.shop_categories WHERE tenant_id = 'tenant-cps'",
      ),
    ).toEqual({ ok: true, filas: 1 })
  })

  it.each([
    "UPDATE public.catalog_overlay SET visible = true WHERE tenant_id = 'tenant-cps'",
    "INSERT INTO public.catalog_overlay (tenant_id, alegra_id) VALUES ('tenant-cps', '9')",
    "DELETE FROM public.catalog_overlay WHERE tenant_id = 'tenant-cps'",
    "UPDATE public.shop_categories SET nombre = 'x' WHERE tenant_id = 'tenant-cps'",
    "INSERT INTO public.shop_categories (tenant_id, nombre, slug) VALUES ('tenant-cps', 'x', 'x')",
    "DELETE FROM public.shop_categories WHERE tenant_id = 'tenant-cps'",
    "TRUNCATE public.catalog_overlay",
  ])("0038: el overlay es de sólo lectura para shop_app: %s → sin permiso", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
  })

  it.each([
    "SELECT 1 FROM public.catalog_products LIMIT 1",
    "SELECT raw FROM public.catalog_products",
    "UPDATE public.catalog_products SET stock = 0",
    "SELECT 1 FROM public.catalog_categories LIMIT 1",
    "UPDATE public.catalog_categories SET name = 'x'",
  ])("tabla base cerrada: %s → sin permiso", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
  })

  it.each([
    "UPDATE public.catalog_products_shop SET stock = 0 WHERE tenant_id = 'tenant-cps'",
    "INSERT INTO public.catalog_products_shop (tenant_id, alegra_id, stock) VALUES ('tenant-cps', '9', 1)",
    "DELETE FROM public.catalog_products_shop WHERE tenant_id = 'tenant-cps'",
  ])("la vista es de sólo lectura: %s → sin permiso", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
  })

  it("los bloques de GRANTs son idempotentes (se pueden correr a mano otra vez)", async () => {
    await expect(sql.unsafe(bloqueDeGrants())).resolves.toBeDefined()
    await expect(sql.unsafe(bloqueDeGrants(MIGRACION_0037))).resolves.toBeDefined()
    await expect(sql.unsafe(bloqueDeGrants(MIGRACION_0038))).resolves.toBeDefined()
  })
})
