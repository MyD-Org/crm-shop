import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migraciones 0080 (columnas de variantes + backfill desde `raw`) y 0081 (la vista del Shop no
 * ofrece padres), change `variantes-de-producto`, rebanada S2.
 *
 * El backfill se prueba reaplicando el MISMO .sql contra filas sembradas con `raw` sintético: la
 * base de test ya está migrada, así que las columnas existen y el ALTER es no-op (eso prueba a la
 * vez que la migración es idempotente). Datos inventados, dominios `.example`.
 */

const M0080 = fileURLToPath(new URL("../../drizzle/0080_variantes_espejo.sql", import.meta.url))
const M0081 = fileURLToPath(new URL("../../drizzle/0081_vista_padre_no_activo.sql", import.meta.url))
const T = "tenant-var"

let sql: postgres.Sql

const sentencias = (archivo: string) =>
  readFileSync(archivo, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)

async function aplicar(archivo: string) {
  for (const s of sentencias(archivo)) await sql.unsafe(s)
}

async function limpiar() {
  await sql`DELETE FROM catalog_products WHERE tenant_id = ${T}`
  await sql`DELETE FROM alegra_cuentas WHERE tenant_id = ${T}`
  await sql`DELETE FROM tenants WHERE id = ${T}`
}

const attr = (nombre: string, valor: string) => ({ id: 1, name: nombre, status: "active", options: [{ id: 2, value: valor }] })

type FilaSembrada = {
  id: string
  name: string
  raw: Record<string, unknown> | null
  cuenta?: string
}

async function sembrar(f: FilaSembrada) {
  await sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, raw, cuenta_id, status, alegra_status)
    VALUES (${T}, ${f.id}, ${f.name}, ${f.raw === null ? null : sql.json(f.raw as never)}, ${f.cuenta ?? null}, 'active', 'active')
  `
}

const leer = async (id: string) => (await sql`SELECT * FROM catalog_products WHERE tenant_id = ${T} AND alegra_id = ${id}`)[0]

describe("migración 0080: backfill de variantes desde raw (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    await limpiar()
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant Var', '/logos/test.svg', 'no-responder@plataforma.example')`
    const [cuenta] = await sql`
      INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${T}, 'mdp', 'Cuenta secundaria', false) RETURNING id
    `
    // Principal: un padre, una variante con variantAttributes, una sin variantAttributes (viene del
    // listado viejo con fields=inventory), un simple y una fila sin raw.
    await sembrar({ id: "100", name: "Cinta LED", raw: { id: 100, type: "variantParent", variantAttributes: [attr("Color", "Verde")] } })
    await sembrar({
      id: "101",
      name: "Cinta LED / Verde",
      raw: { id: 101, type: "variant", idItemParent: 100, variantAttributes: [attr("Color", "Verde Claro")] },
    })
    await sembrar({ id: "102", name: "Cinta LED / Blanco Cálido", raw: { id: 102, type: "variant", idItemParent: "100", variantAttributes: null } })
    await sembrar({ id: "103", name: "Cinta LED / Rojo / 5m", raw: { id: 103, type: "variant", idItemParent: { id: 100 } } })
    await sembrar({ id: "104", name: "Cable 2 / 5m", raw: { id: 104, type: "product" } })
    await sembrar({ id: "105", name: "Sin raw", raw: null })
    // Variante cuyo padre no está en el espejo: queda huérfana.
    await sembrar({ id: "106", name: "Panel / Frío", raw: { id: 106, type: "variant", idItemParent: 999 } })
    // Solo-secundaria: el padre lleva el slug de la cuenta (id sintético).
    await sembrar({ id: "mdp:50", name: "Pantalla", raw: { id: 50, type: "variantParent" }, cuenta: cuenta.id })
    await sembrar({ id: "mdp:51", name: "Pantalla / Negro", raw: { id: 51, type: "variant", idItemParent: 50 }, cuenta: cuenta.id })
    await aplicar(M0080)
  })

  afterAll(async () => {
    if (!sql) return
    await limpiar()
    await sql.end()
  })

  it("tipo desde raw.type: padre, variante, y simple para el resto", async () => {
    expect((await leer("100")).tipo).toBe("padre")
    expect((await leer("101")).tipo).toBe("variante")
    expect((await leer("104")).tipo).toBe("simple")
    expect((await leer("105")).tipo).toBe("simple")
  })

  it("padre desde idItemParent (número, texto u objeto); null en padres y simples", async () => {
    expect((await leer("101")).padre_alegra_id).toBe("100")
    expect((await leer("102")).padre_alegra_id).toBe("100")
    expect((await leer("103")).padre_alegra_id).toBe("100")
    expect((await leer("100")).padre_alegra_id).toBeNull()
    expect((await leer("104")).padre_alegra_id).toBeNull()
  })

  it("en las filas solo-secundaria el padre lleva el slug de la cuenta", async () => {
    expect((await leer("mdp:51")).padre_alegra_id).toBe("mdp:50")
    expect((await leer("mdp:51")).grupo_id).toBe("mdp:50")
  })

  it("la opción sale de variantAttributes si Alegra la entregó", async () => {
    const f = await leer("101")
    expect(f.variante).toEqual([{ atributo: "Color", opcion: "Verde Claro" }])
    expect(f.variante_clave).toBe("verde claro")
    expect(f.etiqueta).toBe("Verde Claro")
  })

  it("sin variantAttributes se deriva del nombre: tras 'Padre / ' o, si no, tras el último ' / '", async () => {
    const f = await leer("102")
    expect(f.variante).toEqual([{ atributo: "Opción", opcion: "Blanco Cálido" }])
    expect(f.variante_clave).toBe("blanco calido")
    // "Cinta LED / Rojo / 5m" con padre "Cinta LED": la opción es todo lo que sigue al nombre del padre.
    expect((await leer("103")).variante).toEqual([{ atributo: "Opción", opcion: "Rojo / 5m" }])
    expect((await leer("103")).etiqueta).toBe("Rojo / 5m")
  })

  it("grupo = el padre sólo si la fila del padre existe; la variante huérfana queda suelta", async () => {
    expect((await leer("101")).grupo_id).toBe("100")
    expect((await leer("106")).grupo_id).toBeNull()
    expect((await leer("100")).grupo_id).toBeNull()
  })

  it("simples y filas sin raw no cambian: tipo 'simple', nada derivado, representante true", async () => {
    for (const id of ["104", "105"]) {
      const f = await leer(id)
      expect(f).toMatchObject({ tipo: "simple", padre_alegra_id: null, variante: null, variante_clave: null, grupo_id: null, etiqueta: null })
      expect(f.es_representante).toBe(true)
    }
  })

  it("es idempotente: reaplicar el SQL no falla, no duplica filas y no pisa lo que la sync ya escribió", async () => {
    const antes = await sql`SELECT count(*)::int AS n FROM catalog_products WHERE tenant_id = ${T}`
    // La sync escribe una opción real distinta de la derivada del nombre.
    await sql`UPDATE catalog_products SET variante = '[{"atributo":"Tono","opcion":"Cálido"}]'::jsonb, variante_clave = 'calido', etiqueta = 'Cálido' WHERE tenant_id = ${T} AND alegra_id = '102'`
    await aplicar(M0080)
    const despues = await sql`SELECT count(*)::int AS n FROM catalog_products WHERE tenant_id = ${T}`
    expect(despues[0].n).toBe(antes[0].n)
    expect((await leer("102")).variante).toEqual([{ atributo: "Tono", opcion: "Cálido" }])
    expect((await leer("101")).tipo).toBe("variante")
  })

  it("el CHECK de tipo rechaza valores fuera de simple / padre / variante", async () => {
    await expect(sql`UPDATE catalog_products SET tipo = 'otro' WHERE tenant_id = ${T} AND alegra_id = '104'`).rejects.toMatchObject({ code: "23514" })
  })

  it("los índices parciales existen", async () => {
    const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'catalog_products' AND indexname IN ('cp_tenant_grupo','cp_tenant_padre')`
    expect(idx.map((i) => i.indexname).sort()).toEqual(["cp_tenant_grupo", "cp_tenant_padre"])
  })
})

describe("migración 0081: la vista del Shop no ofrece padres (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    await limpiar()
    await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${T}, 'Tenant Var', '/logos/test.svg', 'no-responder@plataforma.example')`
    await sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, status, alegra_status)
      VALUES (${T}, 'p1', 'Padre activo', 'padre', 'active', 'active'),
             (${T}, 'v1', 'Variante activa', 'variante', 'active', 'active'),
             (${T}, 's1', 'Simple activo', 'simple', 'active', 'active'),
             (${T}, 's2', 'Simple dado de baja', 'simple', 'active', 'inactive')
    `
    await aplicar(M0081)
  })

  afterAll(async () => {
    if (!sql) return
    await limpiar()
    await sql.end()
  })

  it("el padre figura con activo=false aunque esté activo en Alegra; las variantes y los simples no cambian", async () => {
    const filas = await sql`SELECT alegra_id, activo FROM catalog_products_shop WHERE tenant_id = ${T} ORDER BY alegra_id`
    expect(filas.map((f) => [f.alegra_id, f.activo])).toEqual([
      ["p1", false],
      ["s1", true],
      ["s2", false],
      ["v1", true],
    ])
  })

  it("conserva las 12 columnas del contrato, en orden", async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_products_shop' ORDER BY ordinal_position
    `
    expect(cols.map((c) => c.column_name)).toEqual([
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
    ])
  })

  it("conserva el GRANT de shop_app (y reaplicar la migración no lo rompe)", async () => {
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    expect(existe.length).toBe(1)
    await aplicar(M0081)
    const [r] = await sql`SELECT has_table_privilege('shop_app', 'public.catalog_products_shop', 'SELECT') AS ok`
    expect(r.ok).toBe(true)
    // La tabla base sigue sin SELECT para el Shop.
    const [t] = await sql`SELECT has_table_privilege('shop_app', 'public.catalog_products', 'SELECT') AS ok`
    expect(t.ok).toBe(false)
  })
})
