import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0036 (change `contacto-fuente-unica`, extensión teléfonos): la vista
 * `alegra_contacts_shop` suma `phone_primary`, `phone_secondary` y `mobile` al final, y el
 * bloque de GRANTs re-concede el SELECT que se llevó el DROP VIEW.
 *
 * Como en shop-contacto-write-through: en crm_test el rol no existe cuando el global-setup
 * migra, así que este test lo crea (NOLOGIN, sólo en el Postgres LOCAL de test), corre el MISMO
 * bloque de GRANTs de 0036 leído del .sql y verifica como `shop_app` dentro de transacciones que
 * siempre se revierten. Si creó el rol, lo borra al terminar.
 *
 * Datos inventados: tenant `tenant-tel`, contactos de fantasía, `.example`.
 */

const MIGRACION = fileURLToPath(
  new URL("../../drizzle/0036_alegra_contacts_shop_telefonos.sql", import.meta.url),
)
const TENANT = "tenant-tel"

function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0036: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: postgres.Row[] } | { ok: false; code: string }

async function comoShopApp(stmt: string): Promise<Resultado> {
  let r: Resultado | null = null
  const ROLLBACK = new Error("rollback")
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE shop_app")
      try {
        r = { ok: true, filas: [...(await tx.unsafe(stmt))] }
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

describe("migración 0036: teléfonos en alegra_contacts_shop para shop_app (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())

    await sql`DELETE FROM alegra_contacts WHERE tenant_id = ${TENANT}`
    await sql`DELETE FROM tenants WHERE id = ${TENANT}`
    await sql`
      INSERT INTO tenants (id, name, logo_path, resend_from)
      VALUES (${TENANT}, 'Tenant Tel', '/logos/test.svg', 'no-responder@plataforma.example')
    `
    await sql`
      INSERT INTO alegra_contacts (tenant_id, alegra_id, name, email, phone_primary, phone_secondary,
                                   mobile, phones_norm, seller_id, raw)
      VALUES
        (${TENANT}, '701', 'Con Teléfonos SRL', 'compras@cliente.example', '011 4000-0000',
         '011 4000-0001', '11 5000-0000', ARRAY['1140000000', '1140000001', '1150000000'], '9',
         ${sql.json({ id: "701", name: "Con Teléfonos SRL" })}),
        (${TENANT}, '702', 'Sin Teléfonos', NULL, NULL, NULL, NULL, '{}', NULL,
         ${sql.json({ id: "702", name: "Sin Teléfonos" })})
    `
  })

  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM alegra_contacts WHERE tenant_id = ${TENANT}`
    await sql`DELETE FROM tenants WHERE id = ${TENANT}`
    if (rolCreadoAca) {
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  it("shop_app lee los tres teléfonos tal cual los guardó la sync (NULL si no hay)", async () => {
    const r = await comoShopApp(
      `SELECT alegra_id, phone_primary, phone_secondary, mobile FROM public.alegra_contacts_shop
       WHERE tenant_id = '${TENANT}' ORDER BY alegra_id`,
    )
    if (!r.ok) throw new Error(`SELECT falló con ${r.code}`)
    expect(r.filas.map((f) => ({ ...f }))).toEqual([
      { alegra_id: "701", phone_primary: "011 4000-0000", phone_secondary: "011 4000-0001", mobile: "11 5000-0000" },
      { alegra_id: "702", phone_primary: null, phone_secondary: null, mobile: null },
    ])
  })

  it("la vista sigue sin raw, phones_norm ni seller_id (42703), y la tabla sigue cerrada (42501)", async () => {
    for (const col of ["raw", "phones_norm", "seller_id"]) {
      expect(await comoShopApp(`SELECT ${col} FROM public.alegra_contacts_shop`)).toEqual({
        ok: false,
        code: "42703",
      })
    }
    expect(await comoShopApp("SELECT phone_primary FROM public.alegra_contacts")).toEqual({
      ok: false,
      code: "42501",
    })
  })

  it("has_table_privilege: shop_app tiene SELECT sobre la vista recreada", async () => {
    const [p] = await sql`
      SELECT has_table_privilege('shop_app', 'public.alegra_contacts_shop', 'SELECT') AS select_vista
    `
    expect(p.select_vista).toBe(true)
  })

  it("el bloque de GRANTs es idempotente (se puede correr a mano otra vez)", async () => {
    await expect(sql.unsafe(bloqueDeGrants())).resolves.toBeDefined()
  })
})
