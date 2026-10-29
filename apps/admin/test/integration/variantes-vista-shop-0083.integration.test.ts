import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0083 (change `variantes-de-producto`, S5a): `catalog_products_shop` suma AL FINAL
 * `tipo`, `grupo_id`, `etiqueta`, `es_representante` y `overlay_alegra_id`. Es un contrato con el
 * Shop (apps/clientes/src/db/crm.ts + __fixtures__/crm-contrato.json): las 12 columnas anteriores
 * no se mueven, el padre no se ofrece, el GRANT de `shop_app` se conserva y no se abre nada nuevo.
 *
 * El rol `shop_app` no existe en crm_test cuando el global-setup migra: este test lo crea (NOLOGIN,
 * sólo en el Postgres LOCAL), corre el MISMO bloque de GRANTs leído del .sql y lo borra al final si
 * lo creó. Datos inventados, tenant `tenant-v83`.
 */

const M0083 = fileURLToPath(new URL("../../drizzle/0083_vista_shop_variantes.sql", import.meta.url))
// La vista vigente es la de 0095 (campañas: + campanias_online al final). La de 0083 ya no se puede
// reaplicar (CREATE OR REPLACE no quita columnas): la idempotencia se prueba sobre la de 0095.
const M0095 = fileURLToPath(new URL("../../drizzle/0095_campanias.sql", import.meta.url))
const T = "tenant-v83"

const partes = (archivo: string) =>
  readFileSync(archivo, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)

let sql: postgres.Sql
let rolCreadoAca = false

async function limpiar() {
  await sql`DELETE FROM catalog_products WHERE tenant_id = ${T}`
  await sql`DELETE FROM tenants WHERE id = ${T}`
}

const vista = async (id: string) =>
  (await sql`SELECT * FROM public.catalog_products_shop WHERE tenant_id = ${T} AND alegra_id = ${id}`)[0]

describe("migración 0083: la vista del Shop expone el grupo de variantes (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    // El bloque de GRANTs (último statement) otra vez, ahora que el rol existe.
    const bloque = partes(M0083).at(-1)!
    expect(bloque).toMatch(/DO \$\$/)
    await sql.unsafe(bloque)

    await limpiar()
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant V83', '/logos/test.svg', 'no-responder@plataforma.example')`
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, grupo_id, etiqueta, es_representante, status, alegra_status)
      VALUES (${T}, 'p1', 'Modelo', 'padre', NULL, NULL, NULL, false, 'active', 'active'),
             (${T}, 'v1', 'Modelo / Verde', 'variante', 'p1', 'p1', 'Verde', true, 'active', 'active'),
             (${T}, 'v2', 'Modelo / Rojo', 'variante', 'p1', 'p1', 'Rojo', false, 'active', 'active'),
             (${T}, 'v3', 'Modelo / Huérfana', 'variante', 'zz', NULL, 'Huérfana', true, 'active', 'active'),
             (${T}, 's1', 'Suelto', 'simple', NULL, NULL, NULL, true, 'active', 'active'),
             (${T}, 'v4', 'Modelo / Baja', 'variante', 'p1', 'p1', 'Baja', false, 'active', 'inactive')
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

  it("la vista tiene las 12 columnas originales intactas, las 5 de 0083 y la de 0095 AL FINAL, en orden y con su tipo", async () => {
    const cols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop' ORDER BY ordinal_position
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
      ["tipo", "text"],
      ["grupo_id", "text"],
      ["etiqueta", "text"],
      ["es_representante", "boolean"],
      ["overlay_alegra_id", "text"],
      ["campanias_online", "jsonb"],
    ])
  })

  it("el padre figura inactivo (nunca se ofrece); las variantes y los sueltos conservan su estado", async () => {
    const filas = await sql`SELECT alegra_id, activo, tipo FROM public.catalog_products_shop WHERE tenant_id = ${T} ORDER BY alegra_id`
    expect(filas.map((f) => [f.alegra_id, f.tipo, f.activo])).toEqual([
      ["p1", "padre", false],
      ["s1", "simple", true],
      ["v1", "variante", true],
      ["v2", "variante", true],
      ["v3", "variante", true],
      ["v4", "variante", false],
    ])
  })

  it("grupo, etiqueta y representante salen tal como los derivó recalcularGrupos", async () => {
    expect(await vista("v1")).toMatchObject({ grupo_id: "p1", etiqueta: "Verde", es_representante: true })
    expect(await vista("v2")).toMatchObject({ grupo_id: "p1", etiqueta: "Rojo", es_representante: false })
    expect(await vista("p1")).toMatchObject({ grupo_id: null, es_representante: false })
  })

  it("overlay_alegra_id = el grupo si lo hay (el ancla) y, si no, el propio id", async () => {
    expect((await vista("v1")).overlay_alegra_id).toBe("p1")
    expect((await vista("v2")).overlay_alegra_id).toBe("p1")
    // Huérfana (sin ancla): se vende suelta, su overlay es el suyo.
    expect((await vista("v3")).overlay_alegra_id).toBe("v3")
    expect((await vista("s1")).overlay_alegra_id).toBe("s1")
    expect((await vista("p1")).overlay_alegra_id).toBe("p1")
  })

  it("conserva el GRANT de shop_app sobre la vista; la tabla base y la tabla de grupos manuales siguen cerradas", async () => {
    const q = async (rel: string) =>
      (await sql`SELECT has_table_privilege('shop_app', ${rel}, 'SELECT') AS ok`)[0].ok as boolean
    expect(await q("public.catalog_products_shop")).toBe(true)
    expect(await q("public.catalog_products")).toBe(false)
    expect(await q("public.catalog_variantes_manuales")).toBe(false)
  })

  it("shop_app puede pedir las columnas nuevas por la vista", async () => {
    const ROLLBACK = new Error("rollback")
    let filas = -1
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        const r = await tx.unsafe(
          `SELECT tipo, grupo_id, etiqueta, es_representante, overlay_alegra_id FROM public.catalog_products_shop WHERE tenant_id = '${T}'`,
        )
        filas = r.length
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    expect(filas).toBe(6)
  })

  it("catalog_products_shop_privados no cambia: 4 columnas, sin tipo ni grupo (no filtra variantes privadas)", async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop_privados' ORDER BY ordinal_position
    `
    expect(cols.map((c) => c.column_name)).toEqual(["tenant_id", "alegra_id", "lista_id", "precio"])
  })

  it("es idempotente: reaplicar la vista vigente (0095) y su GRANT no falla ni cambia las columnas", async () => {
    const p = partes(M0095)
    await sql.unsafe(p.find((s) => s.includes('CREATE OR REPLACE VIEW "public"."catalog_products_shop"'))!)
    await sql.unsafe(p[p.length - 1])
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop'
    `
    expect(cols).toHaveLength(18)
  })
})
