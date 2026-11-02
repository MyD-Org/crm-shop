import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0097 (cupones): shop_app lee `cupones_shop` y nunca las tablas; `codigo_norm` normaliza
 * y es único por tenant; los CHECK de la promoción; `precios_online_cambios` admite `cupon`.
 * Mismo patrón que tienda-online-grants-0087: el bloque de GRANTs se lee del .sql. Datos inventados.
 */

const MIGRACION_0097 = fileURLToPath(new URL("../../drizzle/0097_cupones.sql", import.meta.url))

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
const TA = "tenant-cupones-a"
const TB = "tenant-cupones-b"

async function insertarPromo(tenant: string, o: { pct?: number | null; envioGratis?: boolean; inicio?: string; fin?: string; tipo?: string; prefijo?: string | null } = {}) {
  const [r] = await sql`
    INSERT INTO cupon_promociones (tenant_id, nombre, tipo, pct, envio_gratis, inicio, fin, prefijo, creado_por)
    VALUES (${tenant}, 'Promo', ${o.tipo ?? "generica"}, ${o.pct === undefined ? 10 : o.pct}, ${o.envioGratis ?? false},
            ${o.inicio ?? "2026-11-01T00:00:00-03:00"}, ${o.fin ?? "2026-12-01T00:00:00-03:00"}, ${o.prefijo ?? null}, 'test')
    RETURNING id`
  return r.id as string
}

async function insertarCodigo(tenant: string, promo: string, codigo: string) {
  const [r] = await sql`
    INSERT INTO cupon_codigos (promocion_id, tenant_id, codigo, origen)
    VALUES (${promo}, ${tenant}, ${codigo}, 'manual') RETURNING id, codigo_norm`
  return r as { id: string; codigo_norm: string }
}

async function limpiar() {
  await sql`DELETE FROM cupon_promociones WHERE tenant_id IN (${TA}, ${TB})`
  await sql`DELETE FROM precios_online_cambios WHERE tenant_id IN (${TA}, ${TB})`
  await sql`DELETE FROM tenants WHERE id IN (${TA}, ${TB})`
}

describe("migración 0097: cupones (DB real)", () => {
  let promoA: string
  let promoB: string

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants(MIGRACION_0097))

    await limpiar()
    for (const t of [TA, TB]) {
      await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${t}, ${t}, '/logos/test.svg', 'no-responder@plataforma.example')`
    }
    promoA = await insertarPromo(TA)
    promoB = await insertarPromo(TB)
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

  it("shop_app lee cupones_shop y no las tablas", async () => {
    expect((await comoShopApp("SELECT * FROM public.cupones_shop LIMIT 1")).ok).toBe(true)
    expect(await comoShopApp("SELECT * FROM public.cupon_codigos LIMIT 1")).toEqual(SIN_PERMISO)
    expect(await comoShopApp("SELECT * FROM public.cupon_promociones LIMIT 1")).toEqual(SIN_PERMISO)
  })

  it("cupones_shop expone las columnas del contrato, en orden y sin datos internos", async () => {
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cupones_shop' ORDER BY ordinal_position`
    expect(cols.map((c) => c.column_name)).toEqual([
      "tenant_id", "codigo_id", "codigo", "codigo_norm", "promocion_id", "nombre", "tipo", "pct",
      "envio_gratis", "provincias_envio", "inicio", "fin", "vence_en", "solo_primera_compra", "minimo",
      "medios", "formas", "permite_cuotas", "limite_canjes", "condiciones", "activa",
    ])
  })

  it("codigo_norm normaliza y es único por tenant", async () => {
    const c = await insertarCodigo(TA, promoA, "luz-7kq2m")
    expect(c.codigo_norm).toBe("LUZ7KQ2M")
    await expect(insertarCodigo(TA, promoA, "LUZ 7KQ2M")).rejects.toThrow(/cupon_codigos_tenant_norm/)
    await expect(insertarCodigo(TB, promoB, "LUZ-7KQ2M")).resolves.toBeDefined()
  })

  it("la vista muestra también los vencidos (sin filtro de fecha)", async () => {
    const vieja = await insertarPromo(TA, { inicio: "2020-01-01T00:00:00-03:00", fin: "2020-02-01T00:00:00-03:00" })
    await insertarCodigo(TA, vieja, "VIEJO2020")
    const filas = await sql`SELECT 1 FROM cupones_shop WHERE tenant_id = ${TA} AND codigo_norm = 'VIEJO2020'`
    expect(filas).toHaveLength(1)
  })

  it("CHECK: algún beneficio, fin > inicio y prefijo en únicos", async () => {
    await expect(insertarPromo(TA, { pct: null, envioGratis: false })).rejects.toThrow(/cupon_promociones_beneficio_chk/)
    await expect(insertarPromo(TA, { inicio: "2026-11-10T00:00:00-03:00", fin: "2026-11-09T00:00:00-03:00" })).rejects.toThrow(/cupon_promociones_ventana_chk/)
    await expect(insertarPromo(TA, { tipo: "unicos", prefijo: null })).rejects.toThrow(/cupon_promociones_prefijo_chk/)
    await expect(insertarPromo(TA, { pct: 51 })).rejects.toThrow(/cupon_promociones_pct_chk/)
    await expect(insertarPromo(TA, { pct: null, envioGratis: true })).resolves.toBeDefined()
  })

  it("precios_online_cambios admite tipo 'cupon'", async () => {
    await expect(sql`
      INSERT INTO precios_online_cambios (tenant_id, tipo, objeto, antes, despues, usuario)
      VALUES (${TA}, 'cupon', ${"cupon:" + promoA}, NULL, '{}'::jsonb, 'Test')`).resolves.toBeDefined()
  })
})
