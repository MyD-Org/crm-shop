import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0087 (variantes ocultables): shop_app lee de `catalog_overlay` la columna nueva
 * `oculta_en_tienda` y no escribe. Mismo patrón que tienda-online-grants-0086: se corre el
 * MISMO bloque de GRANTs leído del .sql y se verifica como `shop_app`. Datos inventados.
 */

const MIGRACION_0087 = fileURLToPath(new URL("../../drizzle/0087_overlay_oculta_en_tienda.sql", import.meta.url))

function bloqueDeGrants(archivo: string): string {
  const partes = readFileSync(archivo, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error(`${archivo}: no encontré el bloque DO $$ de los GRANTs`)
  return bloque
}

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: unknown[] } | { ok: false; code: string }

/** Corre `stmt` como `shop_app` en una transacción que SIEMPRE se revierte. */
async function comoShopApp(stmt: string): Promise<Resultado> {
  let resultado: Resultado | null = null
  const ROLLBACK = new Error("rollback")
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE shop_app")
      try {
        resultado = { ok: true, filas: [...(await tx.unsafe(stmt))] }
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
const T = "tenant-grants-oculta"

describe("migración 0087: shop_app y oculta_en_tienda (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants(MIGRACION_0087))

    await sql`DELETE FROM catalog_overlay WHERE tenant_id = ${T}`
    await sql`DELETE FROM tenants WHERE id = ${T}`
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant Oculta', '/logos/test.svg', 'no-responder@plataforma.example')`
    await sql`INSERT INTO catalog_overlay (tenant_id, alegra_id) VALUES (${T}, 'v1')`
  })

  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM catalog_overlay WHERE tenant_id = ${T}`
    await sql`DELETE FROM tenants WHERE id = ${T}`
    if (rolCreadoAca) {
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  it("default: false (la variante se muestra)", async () => {
    const r = await comoShopApp(`SELECT oculta_en_tienda FROM public.catalog_overlay`)
    expect(r).toEqual({ ok: true, filas: [{ oculta_en_tienda: false }] })
  })

  // No se prueba `SELECT *`: la 0038 ya concede SELECT sobre TODA la tabla cuando el rol existe (así
  // está en prod), así que el resultado depende de si `shop_app` existía al migrar la base de test.
  it("la columna nueva queda concedida a shop_app", async () => {
    const [{ ok }] = await sql`SELECT has_column_privilege('shop_app', 'public.catalog_overlay', 'oculta_en_tienda', 'SELECT') AS ok`
    expect(ok).toBe(true)
  })

  it("no escribe", async () => {
    expect(await comoShopApp("UPDATE public.catalog_overlay SET oculta_en_tienda = true")).toEqual(SIN_PERMISO)
  })
})
