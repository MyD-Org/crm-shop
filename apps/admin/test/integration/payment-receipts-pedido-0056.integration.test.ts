import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { sql as dsql } from "drizzle-orm"
import { getDb } from "@/db"
import { seedTenant, truncateAll } from "./helpers"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0056 (change `pago-transferencia-comprobante`, rebanada C) contra la base real de
 * test: `codigocliente` admite NULL, el CHECK de dueño (vinculado o pedido + usuario) y los
 * permisos de `shop_app` sobre las columnas nuevas (la 0032 concede SELECT/INSERT de TABLA, y el
 * UPDATE sólo de las columnas del flujo de informar pago). Datos inventados.
 */

const A = "tenant-a"
const MIGRACION_0032 = fileURLToPath(new URL("../../drizzle/0032_shop_cuenta_corriente.sql", import.meta.url))
const PEDIDO = "11111111-2222-4333-8444-555555555555"

/** INSERT crudo (sin pasar por la app) para probar el CHECK de la base. */
async function insertar(cols: Record<string, string | null>) {
  const c: Record<string, string | null> = {
    tenant_id: `'${A}'`,
    razonsocial: "'Comprador Demo'",
    amount: "'1000.00'",
    paid_on: "'2026-10-01'",
    method: "'transferencia'",
    declared_content_type: "'application/pdf'",
    declared_size: "1000",
    ...cols,
  }
  const claves = Object.keys(c).filter((k) => c[k] !== null)
  await getDb().execute(
    dsql.raw(`insert into payment_receipts (${claves.join(",")}) values (${claves.map((k) => c[k]).join(",")})`),
  )
}

function codigo(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

async function rechaza(p: Promise<unknown>, code: string) {
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  expect(err, "debía rechazarlo la base").toBeDefined()
  expect(codigo(err)).toBe(code)
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
})
afterAll(async () => {
  await truncateAll()
})

describe("0056: dueño del comprobante", () => {
  it("vinculado (codigocliente) sin pedido sigue siendo válido", async () => {
    await insertar({ codigocliente: "'42'" })
  })

  it("no vinculado: codigocliente NULL con pedido y usuario", async () => {
    await insertar({ codigocliente: null, shop_order_id: `'${PEDIDO}'`, clerk_user_id: "'user_1'" })
  })

  it("vinculado con pedido y usuario conserva las tres", async () => {
    await insertar({ codigocliente: "'42'", shop_order_id: `'${PEDIDO}'`, clerk_user_id: "'user_1'" })
    const [fila] = (await getDb().execute(
      dsql`select codigocliente, shop_order_id, clerk_user_id from payment_receipts`,
    )) as unknown as { codigocliente: string; shop_order_id: string; clerk_user_id: string }[]
    expect(fila).toEqual({ codigocliente: "42", shop_order_id: PEDIDO, clerk_user_id: "user_1" })
  })

  it("sin codigocliente exige pedido Y usuario: ninguno, o uno solo, se rechaza", async () => {
    await rechaza(insertar({ codigocliente: null }), "23514")
    await rechaza(insertar({ codigocliente: null, shop_order_id: `'${PEDIDO}'` }), "23514")
    await rechaza(insertar({ codigocliente: null, clerk_user_id: "'user_1'" }), "23514")
  })
})

describe("0056: permisos de shop_app sobre las columnas nuevas", () => {
  let sql: postgres.Sql
  let rolCreadoAca = false

  /** El bloque DO $$ de GRANTs tal cual está en la 0032 (el que concede sobre payment_receipts). */
  function bloqueDeGrants(): string {
    const partes = readFileSync(MIGRACION_0032, "utf8").split("--> statement-breakpoint")
    const bloque = partes.find((p) => /DO \$\$/.test(p) && /payment_receipts/.test(p))
    if (!bloque) throw new Error("no encontré el bloque DO $$ de los GRANTs en la 0032")
    return bloque
  }

  const privilegio = async (columna: string, tipo: "SELECT" | "INSERT" | "UPDATE") => {
    const [r] = await sql`select has_column_privilege('shop_app', 'public.payment_receipts', ${columna}, ${tipo}) as ok`
    return r.ok as boolean
  }

  it("lee e inserta shop_order_id y clerk_user_id; no las puede actualizar", async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      const existe = await sql`select 1 from pg_roles where rolname = 'shop_app'`
      if (existe.length === 0) {
        await sql.unsafe("create role shop_app nologin")
        rolCreadoAca = true
      }
      await sql.unsafe(bloqueDeGrants())

      for (const c of ["shop_order_id", "clerk_user_id"]) {
        expect(await privilegio(c, "SELECT"), `SELECT ${c}`).toBe(true)
        expect(await privilegio(c, "INSERT"), `INSERT ${c}`).toBe(true)
        expect(await privilegio(c, "UPDATE"), `UPDATE ${c}`).toBe(false)
      }
      // `codigocliente` tampoco se actualiza (como antes de la 0056).
      expect(await privilegio("codigocliente", "UPDATE")).toBe(false)
    } finally {
      if (rolCreadoAca) {
        await sql.unsafe("drop owned by shop_app")
        await sql.unsafe("drop role shop_app")
      }
      await sql.end()
    }
  })
})
