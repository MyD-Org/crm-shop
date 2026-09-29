import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0042 (change `sucursales-igz-mdp`, rebanada D, lote 1): `alegra_cuentas`,
 * `sucursales.cuenta_alegra_id`, `catalog_stock_sucursal` y las columnas nuevas de
 * `catalog_products` / `catalog_sync_log`.
 *
 * Además es la GUARDA de que lo que el Shop lee sigue igual: la vista `catalog_products_shop` conserva
 * columnas y orden de 0037 (no expone la cuenta de origen) y `shop_app` no ve credenciales.
 *
 * Datos inventados: tenants `tenant-cta-a` / `tenant-cta-b`, slugs `aaa` / `bbb`.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0042_alegra_cuentas.sql", import.meta.url))
const T_A = "tenant-cta-a"
const T_B = "tenant-cta-b"

/** Columnas de la vista tal como las dejó 0037 (orden incluido). */
const COLUMNAS_VISTA_0037 = [
  "tenant_id",
  "alegra_id",
  "stock",
  "precios_alegra",
  "activo",
  "alegra_leido_at",
  "name",
  "description",
  "code",
  "brand",
  "category_alegra_id",
  "iva_porcentaje",
]

const statements = () => readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
const bloqueDeGrants = () => {
  const bloque = statements().at(-1)!
  if (!/DO \$\$/.test(bloque)) throw new Error("0042: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: number } | { ok: false; code: string }

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

async function codigoDeError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return (e as { code?: string }).code ?? "?"
  }
}

async function limpiar() {
  await sql`DELETE FROM catalog_stock_sucursal WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM catalog_sync_log WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM catalog_products WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM sucursales WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM alegra_cuentas WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM tenants WHERE id IN (${T_A}, ${T_B})`
}

const cuenta = async (tenant: string, slug: string, principal = false) => {
  const [c] = await sql`
    INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal, alegra_email, alegra_token)
    VALUES (${tenant}, ${slug}, ${`Cuenta ${slug}`}, ${principal}, 'x@cliente.example', 'token-de-prueba-1234')
    RETURNING id
  `
  return c.id as string
}
const sucursal = (tenant: string, slug: string) =>
  sql`INSERT INTO sucursales (tenant_id, slug, nombre) VALUES (${tenant}, ${slug}, ${`Sucursal ${slug}`})`

describe("migración 0042: cuentas de Alegra y stock por sucursal (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe(bloqueDeGrants())
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())
    // El rol de 0035/0037/0041 (catálogo y sucursales) para el chequeo de "no ve nada más".
    await sql`GRANT USAGE ON SCHEMA public TO shop_app`
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

  beforeEach(async () => {
    await limpiar()
    for (const id of [T_A, T_B]) {
      await sql`
        INSERT INTO tenants (id, name, logo_path, resend_from)
        VALUES (${id}, ${`Tenant ${id}`}, '/logos/test.svg', 'no-responder@plataforma.example')
      `
    }
  })

  it("el bloque de GRANTs es condicional y es el último statement", () => {
    expect(bloqueDeGrants()).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'\)/)
  })

  it("la migración crea una cuenta 'principal' sin credenciales por tenant (dato genérico, idempotente)", async () => {
    const insert = statements().find((s) => /INSERT INTO "alegra_cuentas"/.test(s))!
    await sql.unsafe(insert)
    await sql.unsafe(insert) // ON CONFLICT DO NOTHING
    const filas = await sql`SELECT tenant_id, slug, principal, alegra_email, alegra_token, cuit FROM alegra_cuentas WHERE tenant_id IN (${T_A}, ${T_B}) ORDER BY tenant_id`
    expect(filas.map((f) => [f.tenant_id, f.slug, f.principal, f.alegra_email, f.alegra_token, f.cuit])).toEqual([
      [T_A, "principal", true, "", "", ""],
      [T_B, "principal", true, "", "", ""],
    ])
  })

  it("una sola cuenta principal por tenant; slug único por tenant; el slug tiene formato", async () => {
    await cuenta(T_A, "principal", true)
    expect(await codigoDeError(() => cuenta(T_A, "otra", true))).toBe("23505")
    await cuenta(T_A, "mdp")
    expect(await codigoDeError(() => cuenta(T_A, "mdp"))).toBe("23505")
    await cuenta(T_B, "mdp") // mismo slug en otro tenant: permitido
    for (const slug of ["A1", "x", "con espacio", "a".repeat(13), "ñandú"]) {
      expect(await codigoDeError(() => cuenta(T_A, slug)), slug).toBe("23514")
    }
    await cuenta(T_A, "a".repeat(12))
  })

  it("una sucursal solo puede apuntar a una cuenta de SU tenant (FK compuesta)", async () => {
    const propia = await cuenta(T_A, "mdp")
    const ajena = await cuenta(T_B, "mdp")
    await sucursal(T_A, "aaa")
    await sql`UPDATE sucursales SET cuenta_alegra_id = ${propia} WHERE tenant_id = ${T_A} AND slug = 'aaa'`
    expect(
      await codigoDeError(() => sql`UPDATE sucursales SET cuenta_alegra_id = ${ajena} WHERE tenant_id = ${T_A} AND slug = 'aaa'`),
    ).toBe("23503")
    // Sin cuenta (NULL) siempre vale.
    await sql`UPDATE sucursales SET cuenta_alegra_id = NULL WHERE tenant_id = ${T_A} AND slug = 'aaa'`
  })

  it("catalog_stock_sucursal: PK por producto x sucursal, item_id único por sucursal, origen válido, cascada", async () => {
    await sucursal(T_A, "aaa")
    await sucursal(T_A, "bbb")
    const fila = (sucursalSlug: string, alegraId: string, item: string | null, origen = "sync") =>
      sql`
        INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen)
        VALUES (${T_A}, ${sucursalSlug}, ${alegraId}, ${item}, 5, ${origen})
      `
    await fila("aaa", "p1", "100")
    expect(await codigoDeError(() => fila("aaa", "p1", "101"))).toBe("23505") // PK
    expect(await codigoDeError(() => fila("aaa", "p2", "100"))).toBe("23505") // mismo ítem de la cuenta, otro producto
    await fila("bbb", "p1", "100") // otra sucursal: permitido
    await fila("aaa", "p3", null) // sin item_id_cuenta (ítem sin par): varios permitidos
    await fila("aaa", "p4", null)
    expect(await codigoDeError(() => fila("aaa", "p5", "500", "inventado"))).toBe("23514")
    expect(
      await codigoDeError(
        () => sql`INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, origen) VALUES (${T_A}, 'no-existe', 'p9', 'sync')`,
      ),
    ).toBe("23503")
    const [{ stock }] = await sql`SELECT stock FROM catalog_stock_sucursal WHERE tenant_id = ${T_A} AND sucursal = 'aaa' AND alegra_id = 'p3'`
    expect(Number(stock)).toBe(5)

    await sql`DELETE FROM sucursales WHERE tenant_id = ${T_A} AND slug = 'aaa'`
    const quedan = await sql`SELECT sucursal FROM catalog_stock_sucursal WHERE tenant_id = ${T_A}`
    expect(quedan.map((q) => q.sucursal)).toEqual(["bbb"])
  })

  it("catalog_products: las columnas nuevas son opcionales y las filas actuales quedan como 'principal'", async () => {
    await sql`INSERT INTO catalog_products (tenant_id, alegra_id, name) VALUES (${T_A}, '1', 'Producto de prueba')`
    const [p] = await sql`SELECT cuenta_id, alegra_id_cuenta, reemplazado_por_alegra_id FROM catalog_products WHERE tenant_id = ${T_A}`
    expect(p).toEqual({ cuenta_id: null, alegra_id_cuenta: null, reemplazado_por_alegra_id: null })

    const c = await cuenta(T_A, "mdp")
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, cuenta_id, alegra_id_cuenta)
      VALUES (${T_A}, 'mdp:1', 'Solo en MDP', ${c}, '1')
    `
    // La clave sigue siendo (tenant, alegra_id): el id sintético convive con el numérico igual.
    expect(await codigoDeError(() => sql`INSERT INTO catalog_products (tenant_id, alegra_id, name) VALUES (${T_A}, 'mdp:1', 'Duplicado')`)).toBe("23505")
    expect(
      await codigoDeError(() => sql`INSERT INTO catalog_products (tenant_id, alegra_id, name, cuenta_id) VALUES (${T_A}, '7', 'x', gen_random_uuid())`),
    ).toBe("23503")
    const idx = await sql`SELECT 1 FROM pg_indexes WHERE tablename = 'catalog_products' AND indexname = 'cp_tenant_cuenta'`
    expect(idx.length).toBe(1)
  })

  it("catalog_sync_log.cuenta_id: NULL = la principal", async () => {
    await sql`INSERT INTO catalog_sync_log (tenant_id, trigger) VALUES (${T_A}, 'manual')`
    const [l] = await sql`SELECT cuenta_id FROM catalog_sync_log WHERE tenant_id = ${T_A}`
    expect(l.cuenta_id).toBeNull()
  })

  it("GUARDA: la vista catalog_products_shop conserva columnas y orden de 0037 (no expone la cuenta)", async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop' ORDER BY ordinal_position
    `
    expect(cols.map((c) => c.column_name)).toEqual(COLUMNAS_VISTA_0037)
  })

  it("GUARDA: una fila solo-secundaria entra por la vista con sus columnas de siempre", async () => {
    const c = await cuenta(T_A, "mdp")
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, stock, cuenta_id, alegra_id_cuenta)
      VALUES (${T_A}, 'mdp:9', 'Solo en MDP', 3, ${c}, '9')
    `
    const filas = await sql`SELECT tenant_id, alegra_id, stock, name FROM catalog_products_shop WHERE tenant_id = ${T_A}`
    expect(filas.map((f) => [f.alegra_id, Number(f.stock), f.name])).toEqual([["mdp:9", 3, "Solo en MDP"]])
  })

  describe("permisos de shop_app", () => {
    it("lee catalog_stock_sucursal SOLO por las columnas concedidas (sin item_id_cuenta)", async () => {
      await sucursal(T_A, "aaa")
      await sql`INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen) VALUES (${T_A}, 'aaa', 'p1', '100', 2, 'sync')`
      const ok = await comoShopApp("SELECT tenant_id, sucursal, alegra_id, stock, leido_at FROM public.catalog_stock_sucursal")
      expect(ok).toMatchObject({ ok: true })
      for (const col of ["item_id_cuenta", "origen", "synced_at"]) {
        expect(await comoShopApp(`SELECT ${col} FROM public.catalog_stock_sucursal`), col).toEqual({ ok: false, code: "42501" })
      }
      expect(await comoShopApp("SELECT * FROM public.catalog_stock_sucursal")).toEqual({ ok: false, code: "42501" })
    })

    it("no escribe catalog_stock_sucursal", async () => {
      for (const stmt of [
        "UPDATE public.catalog_stock_sucursal SET stock = 0",
        "DELETE FROM public.catalog_stock_sucursal",
        "INSERT INTO public.catalog_stock_sucursal (tenant_id, sucursal, alegra_id, origen) VALUES ('x', 'y', 'z', 'sync')",
      ]) {
        expect(await comoShopApp(stmt), stmt).toEqual({ ok: false, code: "42501" })
      }
    })

    it("NO ve alegra_cuentas (credenciales), ni cuenta_alegra_id de sucursales, ni las columnas nuevas de catalog_products", async () => {
      await cuenta(T_A, "mdp")
      expect(await comoShopApp("SELECT * FROM public.alegra_cuentas")).toEqual({ ok: false, code: "42501" })
      expect(await comoShopApp("SELECT alegra_token FROM public.alegra_cuentas")).toEqual({ ok: false, code: "42501" })
      expect(await comoShopApp("SELECT cuenta_alegra_id FROM public.sucursales")).toEqual({ ok: false, code: "42501" })
      for (const col of ["cuenta_id", "alegra_id_cuenta", "reemplazado_por_alegra_id"]) {
        expect(await comoShopApp(`SELECT ${col} FROM public.catalog_products`), col).toEqual({ ok: false, code: "42501" })
      }
    })
  })
})
