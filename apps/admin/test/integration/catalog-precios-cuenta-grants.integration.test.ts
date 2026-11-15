import { describe, it, expect, beforeAll, afterAll } from "vitest"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0104 (`catalog_precios_cuenta`, change `listas-alegra-desde-costo`): la tabla es sólo
 * del CRM. `shop_app` recibe 42501 en SELECT/INSERT/UPDATE/DELETE y ninguna vista la expone; la FK
 * compuesta a `alegra_cuentas` ata cada fila a su tenant y cuenta. Datos inventados.
 */

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: unknown[] } | { ok: false; code: string }

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
const TA = "tenant-precios-a"
const TB = "tenant-precios-b"
let cuentaA: string
let cuentaB: string

async function limpiar() {
  await sql`DELETE FROM alegra_cuentas WHERE tenant_id IN (${TA}, ${TB})`
  await sql`DELETE FROM tenants WHERE id IN (${TA}, ${TB})`
}

describe("migración 0104: catalog_precios_cuenta (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await limpiar()
    for (const t of [TA, TB]) {
      await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${t}, ${t}, '/logos/test.svg', 'no-responder@plataforma.example')`
    }
    ;[{ id: cuentaA }] = await sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre) VALUES (${TA}, 'mdp', 'Sucursal A') RETURNING id`
    ;[{ id: cuentaB }] = await sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre) VALUES (${TB}, 'mdp', 'Sucursal B') RETURNING id`
    await sql`
      INSERT INTO catalog_precios_cuenta (tenant_id, cuenta_id, item_id, precios, costo, leido_at)
      VALUES (${TA}, ${cuentaA}, '10', ${sql.json([{ idPriceList: "1", name: "General", price: 160 }])}, 100, now())`
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

  it("shop_app no puede leer ni escribir la tabla", async () => {
    expect(await comoShopApp("SELECT * FROM public.catalog_precios_cuenta")).toEqual(SIN_PERMISO)
    expect(await comoShopApp(`INSERT INTO public.catalog_precios_cuenta (tenant_id, cuenta_id, item_id) VALUES ('${TA}', '${cuentaA}', '11')`)).toEqual(SIN_PERMISO)
    expect(await comoShopApp("UPDATE public.catalog_precios_cuenta SET costo = 1")).toEqual(SIN_PERMISO)
    expect(await comoShopApp("DELETE FROM public.catalog_precios_cuenta")).toEqual(SIN_PERMISO)
  })

  it("ninguna vista del esquema public expone la tabla", async () => {
    const vistas = await sql`SELECT viewname FROM pg_views WHERE schemaname = 'public' AND definition ILIKE '%catalog_precios_cuenta%'`
    expect(vistas).toHaveLength(0)
  })

  it("la fila queda atada al tenant de la cuenta (FK compuesta)", async () => {
    // La cuenta B es del tenant B: con el tenant A no se puede referenciar.
    await expect(
      sql`INSERT INTO catalog_precios_cuenta (tenant_id, cuenta_id, item_id) VALUES (${TA}, ${cuentaB}, '12')`,
    ).rejects.toMatchObject({ code: "23503" })
  })

  it("la PK impide duplicar el ítem en la misma cuenta y los valores por defecto son los esperados", async () => {
    await expect(
      sql`INSERT INTO catalog_precios_cuenta (tenant_id, cuenta_id, item_id) VALUES (${TA}, ${cuentaA}, '10')`,
    ).rejects.toMatchObject({ code: "23505" })
    await sql`INSERT INTO catalog_precios_cuenta (tenant_id, cuenta_id, item_id) VALUES (${TA}, ${cuentaA}, '13')`
    const [f] = await sql`SELECT tipo, estado, precios, costo, leido_at FROM catalog_precios_cuenta WHERE item_id = '13'`
    expect(f).toMatchObject({ tipo: "simple", estado: "active", precios: [], costo: null, leido_at: null })
  })

  it("borrar la cuenta borra su espejo", async () => {
    const [{ id }] = await sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre) VALUES (${TA}, 'otra', 'Otra') RETURNING id`
    await sql`INSERT INTO catalog_precios_cuenta (tenant_id, cuenta_id, item_id) VALUES (${TA}, ${id}, '1')`
    await sql`DELETE FROM alegra_cuentas WHERE id = ${id}`
    expect(await sql`SELECT 1 FROM catalog_precios_cuenta WHERE cuenta_id = ${id}`).toHaveLength(0)
  })
})
