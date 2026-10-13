import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0085 (marca de la tienda): shop_app lee de `tenants` la columna nueva `shop_marca`
 * además de las de la 0032 y la 0078, y nada más (ni shop_url ni shop_internal_url, de la 0084). Mismo patrón que
 * listas-privadas-grants-0068: se corre el MISMO bloque de GRANTs leído del .sql y se verifica
 * como `shop_app`. Datos inventados.
 */

const MIGRACION_0078 = fileURLToPath(new URL("../../drizzle/0078_chat_tienda_textos.sql", import.meta.url))
const MIGRACION_0032 = fileURLToPath(new URL("../../drizzle/0032_shop_cuenta_corriente.sql", import.meta.url))
const MIGRACION_0085 = fileURLToPath(new URL("../../drizzle/0085_tenants_shop_marca.sql", import.meta.url))

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
const T = "tenant-grants-marca"

describe("migración 0085: shop_app y la marca de la tienda (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    for (const m of [MIGRACION_0032, MIGRACION_0085]) await sql.unsafe(bloqueDeGrants(m))

    await sql`DELETE FROM tenants WHERE id = ${T}`
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant Marca', '/logos/test.svg', 'no-responder@plataforma.example')`
  })

  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM tenants WHERE id = ${T}`
    if (rolCreadoAca) {
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  it("default: objeto vacío (el Shop se ve como siempre)", async () => {
    const r = await comoShopApp(`SELECT shop_marca FROM public.tenants WHERE id = '${T}'`)
    expect(r).toEqual({ ok: true, filas: [{ shop_marca: {} }] })
  })

  it("lee junto con las columnas de la 0032 y la 0078", async () => {
    const r = await comoShopApp(
      `SELECT id, name, whatsapp_number, receipts_email, chat_empty_state, chat_suggestions, shop_marca FROM public.tenants WHERE id = '${T}'`,
    )
    expect(r.ok).toBe(true)
  })

  it.each([
    "SELECT * FROM public.tenants",
    "SELECT alegra_token FROM public.tenants",
    "SELECT shop_url FROM public.tenants",
    "SELECT shop_internal_url FROM public.tenants",
  ])("%s → sin permiso", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
  })

  it("no escribe", async () => {
    expect(await comoShopApp("UPDATE public.tenants SET shop_marca = '{}'::jsonb")).toEqual(SIN_PERMISO)
  })
})
