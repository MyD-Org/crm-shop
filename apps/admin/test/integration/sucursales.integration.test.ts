import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0041 (change `sucursales-igz-mdp`, rebanada A): tablas `sucursales` y `zonas`.
 *
 * Cubre las garantías que da la DB: slug único por tenant y con formato, una sola predeterminada
 * y una sola maestra por tenant (la transferencia de la maestra se hace en una transacción,
 * primero se baja la vieja y después se sube la nueva), FK compuestas de `zonas`, y los GRANTs
 * a `shop_app` (SELECT por columna en `sucursales`, sin credenciales ni columnas internas).
 *
 * Mismo patrón que catalog-products-shop-grants: el rol no existe cuando el global-setup migra;
 * el test lo crea (NOLOGIN, sólo en el Postgres LOCAL), corre el MISMO bloque de GRANTs leído del
 * .sql y verifica como `shop_app`. Si creó el rol, lo borra al final.
 *
 * Datos inventados: tenants `tenant-suc-a` / `tenant-suc-b`, slugs `aaa`/`bbb`, sin nada real.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0041_sucursales_zonas.sql", import.meta.url))

/** El bloque de GRANTs tal cual está en la migración (último statement). */
function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0041: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

const T_A = "tenant-suc-a"
const T_B = "tenant-suc-b"

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: number } | { ok: false; code: string }

/** Corre `stmt` como `shop_app` en una transacción que SIEMPRE se revierte. */
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

/** Código SQLSTATE de un statement que se espera que falle (o null si no falló). */
async function codigoDeError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return (e as { code?: string }).code ?? "?"
  }
}

async function limpiar() {
  await sql`DELETE FROM zonas WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM sucursales WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM tenants WHERE id IN (${T_A}, ${T_B})`
}

async function crearSucursal(tenant: string, slug: string, extra: { predeterminada?: boolean; maestra?: boolean } = {}) {
  await sql`
    INSERT INTO sucursales (tenant_id, slug, nombre, predeterminada, maestra)
    VALUES (${tenant}, ${slug}, ${`Sucursal ${slug}`}, ${extra.predeterminada ?? false}, ${extra.maestra ?? false})
  `
}

describe("migración 0041: sucursales y zonas (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      // Sin el rol, el bloque condicional no concede nada y no falla (como en crm_test al migrar).
      await sql.unsafe(bloqueDeGrants())
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())
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

  it("el bloque de GRANTs es condicional: no falla si el rol no existe", () => {
    expect(bloqueDeGrants()).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'\)/)
  })

  it("slug único por tenant, pero el mismo slug puede existir en otro tenant", async () => {
    await crearSucursal(T_A, "aaa")
    expect(await codigoDeError(() => crearSucursal(T_A, "aaa"))).toBe("23505")
    await crearSucursal(T_B, "aaa")
    const filas = await sql`SELECT 1 FROM sucursales WHERE slug = 'aaa' AND tenant_id IN (${T_A}, ${T_B})`
    expect(filas.length).toBe(2)
  })

  it("rechaza slugs con formato inválido (mayúsculas, espacios, muy corto o muy largo)", async () => {
    for (const slug of ["A1", "con espacio", "x", "a".repeat(21), "ñandú"]) {
      expect(await codigoDeError(() => crearSucursal(T_A, slug)), slug).toBe("23514")
    }
    await crearSucursal(T_A, "mdp-2")
    await crearSucursal(T_A, "a".repeat(20))
  })

  it("una sola predeterminada por tenant (otra en otro tenant sí)", async () => {
    await crearSucursal(T_A, "aaa", { predeterminada: true })
    expect(await codigoDeError(() => crearSucursal(T_A, "bbb", { predeterminada: true }))).toBe("23505")
    await crearSucursal(T_A, "bbb")
    await crearSucursal(T_B, "aaa", { predeterminada: true })
  })

  it("una sola maestra por tenant: marcar otra sin bajar la vieja falla", async () => {
    await crearSucursal(T_A, "aaa", { maestra: true })
    await crearSucursal(T_A, "bbb")
    const codigo = await codigoDeError(
      () => sql`UPDATE sucursales SET maestra = true WHERE tenant_id = ${T_A} AND slug = 'bbb'`,
    )
    expect(codigo).toBe("23505")
  })

  it("la maestra se transfiere de forma atómica en una transacción (baja la vieja, sube la nueva)", async () => {
    await crearSucursal(T_A, "aaa", { maestra: true })
    await crearSucursal(T_A, "bbb")
    await sql.begin(async (tx) => {
      await tx`UPDATE sucursales SET maestra = false WHERE tenant_id = ${T_A} AND maestra`
      await tx`UPDATE sucursales SET maestra = true WHERE tenant_id = ${T_A} AND slug = 'bbb'`
    })
    const maestras = await sql`SELECT slug FROM sucursales WHERE tenant_id = ${T_A} AND maestra`
    expect(maestras.map((r) => r.slug)).toEqual(["bbb"])
  })

  it("si la transferencia falla a mitad de camino, no queda el tenant sin maestra", async () => {
    await crearSucursal(T_A, "aaa", { maestra: true })
    await codigoDeError(() =>
      sql.begin(async (tx) => {
        await tx`UPDATE sucursales SET maestra = false WHERE tenant_id = ${T_A} AND maestra`
        await tx`UPDATE sucursales SET maestra = true WHERE tenant_id = ${T_A} AND slug = 'inexistente'`
        throw new Error("falla simulada")
      }),
    )
    const maestras = await sql`SELECT slug FROM sucursales WHERE tenant_id = ${T_A} AND maestra`
    expect(maestras.map((r) => r.slug)).toEqual(["aaa"])
  })

  it("zonas: una fila por provincia y tenant", async () => {
    await crearSucursal(T_A, "aaa")
    await sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal) VALUES (${T_A}, 'misiones', 'Misiones', 'aaa')`
    const codigo = await codigoDeError(
      () => sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal) VALUES (${T_A}, 'misiones', 'Misiones', 'aaa')`,
    )
    expect(codigo).toBe("23505")
  })

  it("zonas: la FK compuesta exige una sucursal existente del MISMO tenant", async () => {
    await crearSucursal(T_A, "aaa")
    expect(
      await codigoDeError(
        () => sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal) VALUES (${T_A}, 'salta', 'Salta', 'no-existe')`,
      ),
    ).toBe("23503")
    // La sucursal `aaa` existe en T_A, no en T_B.
    expect(
      await codigoDeError(
        () => sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal) VALUES (${T_B}, 'salta', 'Salta', 'aaa')`,
      ),
    ).toBe("23503")
  })

  it("zonas: factura_sucursal es opcional, pero si viene debe existir", async () => {
    await crearSucursal(T_A, "aaa")
    await sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal, factura_sucursal) VALUES (${T_A}, 'jujuy', 'Jujuy', 'aaa', NULL)`
    expect(
      await codigoDeError(
        () => sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal, factura_sucursal) VALUES (${T_A}, 'chaco', 'Chaco', 'aaa', 'no-existe')`,
      ),
    ).toBe("23503")
  })

  it("no se puede borrar una sucursal que una zona usa", async () => {
    await crearSucursal(T_A, "aaa")
    await sql`INSERT INTO zonas (tenant_id, provincia_clave, provincia, sucursal) VALUES (${T_A}, 'misiones', 'Misiones', 'aaa')`
    expect(await codigoDeError(() => sql`DELETE FROM sucursales WHERE tenant_id = ${T_A} AND slug = 'aaa'`)).toBe("23503")
  })

  it("shop_app lee las columnas públicas de sucursales y toda zonas", async () => {
    await crearSucursal(T_A, "aaa")
    const publicas =
      "tenant_id, slug, nombre, direccion, ciudad, provincia, whatsapp, horario, acepta_retiro, acepta_envio, envio_ciudades, orden, activa, predeterminada"
    expect(await comoShopApp(`SELECT ${publicas} FROM public.sucursales`)).toEqual({ ok: true, filas: 1 })
    expect(await comoShopApp("SELECT * FROM public.zonas")).toEqual({ ok: true, filas: 0 })
  })

  it("shop_app no lee las columnas internas de sucursales ni escribe nada", async () => {
    await crearSucursal(T_A, "aaa")
    const sinPermiso = { ok: false, code: "42501" }
    expect(await comoShopApp("SELECT id FROM public.sucursales")).toEqual(sinPermiso)
    expect(await comoShopApp("SELECT deposito_alegra_id FROM public.sucursales")).toEqual(sinPermiso)
    expect(await comoShopApp("SELECT created_at FROM public.sucursales")).toEqual(sinPermiso)
    expect(await comoShopApp("SELECT maestra FROM public.sucursales")).toEqual(sinPermiso)
    expect(await comoShopApp("SELECT * FROM public.sucursales")).toEqual(sinPermiso)
    expect(await comoShopApp("UPDATE public.sucursales SET nombre = 'x'")).toEqual(sinPermiso)
    expect(await comoShopApp("DELETE FROM public.zonas")).toEqual(sinPermiso)
  })
})
