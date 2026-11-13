import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0101 (métodos de envío por zona): `shop_app` lee las cuatro tablas y no puede escribir;
 * un tenant ajeno no se mezcla; los CHECK (ítem de Alegra para activar, precio, geometría, formato
 * de georef/cp, margen, días, slug) y las FK compuestas. Mismo patrón que cupones-grants-0097: el
 * bloque de GRANTs se lee del .sql. Datos inventados.
 */

const MIGRACION_0101 = fileURLToPath(new URL("../../drizzle/0101_metodos_envio.sql", import.meta.url))

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
const TA = "tenant-envio-a"
const TB = "tenant-envio-b"
const CUADRADO = [[[[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95], [-57.6, -37.95], [-57.6, -38.05]]]]

async function metodo(tenant: string, o: { slug?: string; activo?: boolean; item?: string | null; margen?: number; dias?: string } = {}) {
  const [r] = await sql`
    INSERT INTO metodos_envio (tenant_id, slug, nombre, provincia_clave, activo, item_alegra_id, margen_min, dias_operativos)
    VALUES (${tenant}, ${o.slug ?? "envio-en-el-dia"}, 'Envío en el día', 'buenosaires', ${o.activo ?? false},
            ${o.item === undefined ? null : o.item}, ${o.margen ?? 0}, ${o.dias ?? "{1,2,3,4,5}"}::smallint[])
    RETURNING id`
  return r.id as string
}

async function zona(metodoId: string, nombre = "Centro", precio = 3000, geometria: unknown = CUADRADO) {
  const [r] = await sql`
    INSERT INTO metodos_envio_zonas (metodo_id, nombre, precio, geometria)
    VALUES (${metodoId}, ${nombre}, ${precio}, ${sql.json(geometria as never)}) RETURNING id`
  return r.id as string
}

async function limpiar() {
  await sql`DELETE FROM metodos_envio WHERE tenant_id IN (${TA}, ${TB})`
  await sql`DELETE FROM tenants WHERE id IN (${TA}, ${TB})`
}

describe("migración 0101: métodos de envío por zona (DB real)", () => {
  let metodoA: string
  let metodoB: string
  let zonaA: string

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants(MIGRACION_0101))

    await limpiar()
    for (const t of [TA, TB]) {
      await sql`INSERT INTO tenants (id, name, logo_path, resend_from) VALUES (${t}, ${t}, '/logos/test.svg', 'no-responder@plataforma.example')`
    }
    metodoA = await metodo(TA)
    metodoB = await metodo(TB)
    zonaA = await zona(metodoA)
    await sql`
      INSERT INTO metodos_envio_zona_entradas (zona_id, metodo_id, tipo, valor, etiqueta, nombre_norm)
      VALUES (${zonaA}, ${metodoA}, 'cp', '7600', 'CP 7600', '7600')`
    await sql`
      INSERT INTO metodos_envio_localidades (metodo_id, georef_id, etiqueta, nombre_norm, abreviaturas)
      VALUES (${metodoA}, '9990001', 'Ciudad Ejemplo — Buenos Aires', 'ciudadejemplo', ARRAY['ce'])`
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

  it("shop_app lee las cuatro tablas", async () => {
    for (const t of ["metodos_envio", "metodos_envio_zonas", "metodos_envio_zona_entradas", "metodos_envio_localidades"]) {
      expect((await comoShopApp(`SELECT * FROM public.${t} LIMIT 1`)).ok, t).toBe(true)
    }
  })

  it("shop_app no puede escribir ninguna", async () => {
    expect(await comoShopApp(`INSERT INTO public.metodos_envio (tenant_id, slug, nombre, provincia_clave) VALUES ('${TA}', 'otro', 'x', 'buenosaires')`)).toEqual(SIN_PERMISO)
    expect(await comoShopApp(`UPDATE public.metodos_envio_zonas SET precio = 1`)).toEqual(SIN_PERMISO)
    expect(await comoShopApp(`DELETE FROM public.metodos_envio_zona_entradas`)).toEqual(SIN_PERMISO)
    expect(await comoShopApp(`DELETE FROM public.metodos_envio_localidades`)).toEqual(SIN_PERMISO)
  })

  it("el tenant ajeno no se mezcla: cada método ve sólo lo suyo", async () => {
    const filas = await sql`SELECT tenant_id FROM metodos_envio WHERE tenant_id IN (${TA}, ${TB}) ORDER BY tenant_id`
    expect(filas.map((f) => f.tenant_id)).toEqual([TA, TB])
    const deB = await sql`SELECT z.id FROM metodos_envio_zonas z JOIN metodos_envio m ON m.id = z.metodo_id WHERE m.tenant_id = ${TB}`
    expect(deB).toHaveLength(0)
    expect(metodoB).toBeDefined()
  })

  it("CHECK: no se puede activar un método sin ítem de Alegra", async () => {
    await expect(metodo(TA, { slug: "sin-item", activo: true, item: null })).rejects.toThrow(/metodos_envio_activo_item_chk/)
    await expect(metodo(TA, { slug: "con-item", activo: true, item: "9001" })).resolves.toBeDefined()
    await expect(sql`UPDATE metodos_envio SET activo = true, item_alegra_id = NULL WHERE id = ${metodoA}`).rejects.toThrow(/metodos_envio_activo_item_chk/)
  })

  it("CHECK: slug, margen y días", async () => {
    await expect(metodo(TA, { slug: "Mal Slug" })).rejects.toThrow(/metodos_envio_slug_chk/)
    await expect(metodo(TA, { slug: "margen-neg", margen: -1 })).rejects.toThrow(/metodos_envio_margen_chk/)
    await expect(metodo(TA, { slug: "margen-alto", margen: 241 })).rejects.toThrow(/metodos_envio_margen_chk/)
    // Desde 0102 el sábado (6) vale; el domingo (7) no.
    await expect(metodo(TA, { slug: "dias-sab", dias: "{1,6}" })).resolves.toBeDefined()
    await expect(metodo(TA, { slug: "dias-dom", dias: "{1,7}" })).rejects.toThrow(/metodos_envio_dias_chk/)
    await expect(metodo(TA, { slug: "dias-vacio", dias: "{}" })).rejects.toThrow(/metodos_envio_dias_chk/)
  })

  it("slug único por tenant", async () => {
    await expect(metodo(TA, { slug: "envio-en-el-dia" })).rejects.toThrow(/metodos_envio_tenant_slug_uniq/)
    await expect(metodo(TB, { slug: "otro-b" })).resolves.toBeDefined()
  })

  it("CHECK de zona: precio positivo y geometría array", async () => {
    await expect(zona(metodoA, "Gratis", 0)).rejects.toThrow(/metodos_envio_zonas_precio_chk/)
    await expect(zona(metodoA, "Objeto", 100, {})).rejects.toThrow(/metodos_envio_zonas_geometria_chk/)
    await expect(zona(metodoA, "Centro")).rejects.toThrow(/metodos_envio_zonas_metodo_nombre_uniq/)
  })

  it("CHECK de entradas: georef numérico, CP de 4 dígitos o CPA; una entrada por método", async () => {
    const entrada = (tipo: string, valor: string) => sql`
      INSERT INTO metodos_envio_zona_entradas (zona_id, metodo_id, tipo, valor, etiqueta, nombre_norm)
      VALUES (${zonaA}, ${metodoA}, ${tipo}, ${valor}, 'x', 'x')`
    await expect(entrada("georef", "abc")).rejects.toThrow(/metodos_envio_zona_entradas_valor_chk/)
    await expect(entrada("cp", "76")).rejects.toThrow(/metodos_envio_zona_entradas_valor_chk/)
    await expect(entrada("nombre", "x")).rejects.toThrow(/metodos_envio_zona_entradas_valor_chk/)
    await expect(entrada("cp", "B7600ABC")).resolves.toBeDefined()
    await expect(entrada("cp", "7600")).rejects.toThrow(/metodos_envio_zona_entradas_metodo_tipo_valor_uniq/)
  })

  it("la FK compuesta impide una entrada con una zona de otro método", async () => {
    await expect(sql`
      INSERT INTO metodos_envio_zona_entradas (zona_id, metodo_id, tipo, valor, etiqueta, nombre_norm)
      VALUES (${zonaA}, ${metodoB}, 'cp', '7601', 'x', 'x')`).rejects.toThrow(/metodos_envio_zona_entradas_zona_fk/)
  })

  it("CHECK de localidades: georef numérico y único por método", async () => {
    await expect(sql`INSERT INTO metodos_envio_localidades (metodo_id, georef_id, etiqueta, nombre_norm) VALUES (${metodoA}, 'x1', 'x', 'x')`).rejects.toThrow(/metodos_envio_localidades_georef_chk/)
    await expect(sql`INSERT INTO metodos_envio_localidades (metodo_id, georef_id, etiqueta, nombre_norm) VALUES (${metodoA}, '9990001', 'x', 'x')`).rejects.toThrow(/metodos_envio_localidades_metodo_georef_uniq/)
  })

  it("borrar el método borra zonas, entradas y localidades en cascada", async () => {
    const m = await metodo(TB, { slug: "para-borrar" })
    const z = await zona(m, "Zona")
    await sql`INSERT INTO metodos_envio_zona_entradas (zona_id, metodo_id, tipo, valor, etiqueta, nombre_norm) VALUES (${z}, ${m}, 'cp', '7000', 'x', 'x')`
    await sql`INSERT INTO metodos_envio_localidades (metodo_id, georef_id, etiqueta, nombre_norm) VALUES (${m}, '123', 'x', 'x')`
    await sql`DELETE FROM metodos_envio WHERE id = ${m}`
    expect(await sql`SELECT 1 FROM metodos_envio_zonas WHERE metodo_id = ${m}`).toHaveLength(0)
    expect(await sql`SELECT 1 FROM metodos_envio_zona_entradas WHERE metodo_id = ${m}`).toHaveLength(0)
    expect(await sql`SELECT 1 FROM metodos_envio_localidades WHERE metodo_id = ${m}`).toHaveLength(0)
  })
})
