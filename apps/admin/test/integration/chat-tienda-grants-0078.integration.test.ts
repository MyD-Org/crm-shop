import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0078 (textos del chat del Shop): shop_app lee de `tenants` las dos columnas nuevas
 * (`chat_empty_state`, `chat_suggestions`) además de las de la 0032, y nada más. Mismo patrón que
 * listas-privadas-grants-0068: se corre el MISMO bloque de GRANTs leído del .sql y se verifica
 * como `shop_app`. Datos inventados.
 */

const MIGRACION_0032 = fileURLToPath(new URL("../../drizzle/0032_shop_cuenta_corriente.sql", import.meta.url))
const MIGRACION_0078 = fileURLToPath(new URL("../../drizzle/0078_chat_tienda_textos.sql", import.meta.url))

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
const T = "tenant-grants-chat"

describe("migración 0078: shop_app y los textos del chat (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    for (const m of [MIGRACION_0032, MIGRACION_0078]) await sql.unsafe(bloqueDeGrants(m))

    await sql`DELETE FROM tenants WHERE id = ${T}`
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant Chat', '/logos/test.svg', 'no-responder@plataforma.example')`
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

  it("defaults: texto vacío y array vacío (el Shop usa los suyos)", async () => {
    const r = await comoShopApp(`SELECT chat_empty_state, chat_suggestions FROM public.tenants WHERE id = '${T}'`)
    expect(r).toEqual({ ok: true, filas: [{ chat_empty_state: "", chat_suggestions: [] }] })
  })

  it("lee junto con las columnas de la 0032", async () => {
    const r = await comoShopApp(
      `SELECT id, name, whatsapp_number, receipts_email, chat_empty_state, chat_suggestions FROM public.tenants WHERE id = '${T}'`,
    )
    expect(r.ok).toBe(true)
  })

  it.each(["SELECT * FROM public.tenants", "SELECT alegra_token FROM public.tenants"])("%s → sin permiso", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
  })

  it("no escribe", async () => {
    expect(await comoShopApp("UPDATE public.tenants SET chat_empty_state = 'x'")).toEqual(SIN_PERMISO)
  })
})
