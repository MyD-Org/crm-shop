import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { sql as dsql } from "drizzle-orm"
import { getDb } from "@/db"
import { sucursales } from "@/db/schema"
import {
  actualizarCuenta,
  crearCuenta,
  eliminarCuenta,
  listarCuentas,
} from "@/lib/cuentas-bancarias-shop-repo"
import { seedTenant, truncateAll } from "./helpers"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0055 (change `pago-transferencia-comprobante`, rebanada A) contra la base real de
 * test: CHECKs, índice único parcial de la predeterminada, UNIQUE (tenant, CBU), el repo (tx de
 * predeterminada, slugs inexistentes) y el GRANT por columna a `shop_app`. Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"
const cbu = (n: number) => String(n).padStart(22, "0")
const MIGRACION = fileURLToPath(new URL("../../drizzle/0055_cuentas_bancarias_shop.sql", import.meta.url))

const base = (n: number, extra: Record<string, unknown> = {}) => ({
  alias: `cuenta.${n}`,
  cbu: cbu(n),
  todasLasSucursales: true,
  ...extra,
})

/** INSERT crudo (sin pasar por la validación de la app) para probar los CHECKs de la base. */
async function insertarCrudo(cols: Record<string, string>) {
  const c = { tenant_id: "'tenant-a'", alias: "'x'", cbu: `'${cbu(99)}'`, ...cols }
  await getDb().execute(
    dsql.raw(`insert into cuentas_bancarias_shop (${Object.keys(c).join(",")}) values (${Object.values(c).join(",")})`),
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
  await seedTenant(B)
  await getDb().insert(sucursales).values([
    { tenantId: A, slug: "igz", nombre: "Sede IGZ" },
    { tenantId: A, slug: "mdp", nombre: "Sede MDP" },
    { tenantId: B, slug: "otra", nombre: "Otra sede" },
  ])
})
afterAll(async () => {
  await truncateAll()
})

describe("0055: restricciones de la tabla", () => {
  it("ni 'todas' ni sucursales listadas → CHECK; todas con lista → CHECK", async () => {
    await rechaza(insertarCrudo({ todas_las_sucursales: "false", sucursal_slugs: "'{}'" }), "23514")
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", sucursal_slugs: "'{igz}'" }), "23514")
    await insertarCrudo({ todas_las_sucursales: "true" })
  })

  it("rango: min <= max, min >= 0, max > 0", async () => {
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", monto_min: "1000", monto_max: "500" }), "23514")
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", monto_min: "-1" }), "23514")
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", monto_max: "0" }), "23514")
  })

  it("CBU de 22 dígitos y CUIT de 11 (o vacío)", async () => {
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", cbu: "'123'" }), "23514")
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", cuit: "'123'" }), "23514")
  })

  it("predeterminada inactiva → CHECK; dos predeterminadas del tenant → índice único parcial", async () => {
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", predeterminada: "true", activa: "false" }), "23514")
    await insertarCrudo({ todas_las_sucursales: "true", predeterminada: "true", cbu: `'${cbu(1)}'` })
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", predeterminada: "true", cbu: `'${cbu(2)}'` }), "23505")
    // otro tenant sí puede tener la suya
    await insertarCrudo({ tenant_id: "'tenant-b'", todas_las_sucursales: "true", predeterminada: "true", cbu: `'${cbu(3)}'` })
  })

  it("el CBU no se repite dentro del tenant (sí en otro)", async () => {
    await insertarCrudo({ todas_las_sucursales: "true", cbu: `'${cbu(1)}'` })
    await rechaza(insertarCrudo({ todas_las_sucursales: "true", cbu: `'${cbu(1)}'` }), "23505")
    await insertarCrudo({ tenant_id: "'tenant-b'", todas_las_sucursales: "true", cbu: `'${cbu(1)}'` })
  })
})

describe("repo de cuentas bancarias", () => {
  it("alta con sucursales elegidas y rango; listado ordenado y aislado por tenant", async () => {
    const r = await crearCuenta(A, base(1, { todasLasSucursales: false, sucursalSlugs: ["igz", "mdp"], montoMin: 0, montoMax: 500000, orden: 2 }))
    expect(r).toMatchObject({
      kind: "ok",
      cuenta: { todasLasSucursales: false, sucursalSlugs: ["igz", "mdp"], montoMin: 0, montoMax: 500000, activa: true, predeterminada: false },
    })
    await crearCuenta(A, base(2, { orden: 1 }))
    await crearCuenta(B, base(3, { todasLasSucursales: false, sucursalSlugs: ["otra"] }))
    expect((await listarCuentas(A)).map((c) => c.alias)).toEqual(["cuenta.2", "cuenta.1"])
    expect((await listarCuentas(B)).map((c) => c.alias)).toEqual(["cuenta.3"])
  })

  it("slug inexistente o de otro tenant → invalid; no persiste", async () => {
    expect(await crearCuenta(A, base(1, { todasLasSucursales: false, sucursalSlugs: ["nada"] }))).toMatchObject({ kind: "invalid", campo: "sucursalSlugs" })
    expect(await crearCuenta(A, base(1, { todasLasSucursales: false, sucursalSlugs: ["otra"] }))).toMatchObject({ kind: "invalid", campo: "sucursalSlugs" })
    expect(await listarCuentas(A)).toEqual([])
  })

  it("ninguna de las dos opciones de sucursal → invalid con el mensaje en usted", async () => {
    expect(await crearCuenta(A, { alias: "x", cbu: cbu(1), todasLasSucursales: false })).toEqual({
      kind: "invalid",
      campo: "sucursalSlugs",
      error: "Seleccione 'Todas las sucursales' o al menos una sucursal.",
    })
  })

  it("CBU repetido → conflict", async () => {
    await crearCuenta(A, base(1))
    expect(await crearCuenta(A, base(1, { alias: "otra" }))).toEqual({ kind: "conflict", campo: "cbu", error: "Ya existe una cuenta con ese CBU." })
  })

  it("marcar predeterminada desmarca la anterior en la misma transacción", async () => {
    const a = await crearCuenta(A, base(1, { predeterminada: true }))
    const b = await crearCuenta(A, base(2))
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("alta")
    expect(a.cuenta.predeterminada).toBe(true)

    expect(await actualizarCuenta(A, b.cuenta.id, { predeterminada: true })).toMatchObject({ kind: "ok", cuenta: { predeterminada: true } })
    const lista = await listarCuentas(A)
    expect(lista.filter((c) => c.predeterminada).map((c) => c.alias)).toEqual(["cuenta.2"])

    // alta directa como predeterminada también transfiere
    await crearCuenta(A, base(3, { predeterminada: true }))
    expect((await listarCuentas(A)).filter((c) => c.predeterminada).map((c) => c.alias)).toEqual(["cuenta.3"])
  })

  it("no deja desactivar la predeterminada", async () => {
    const a = await crearCuenta(A, base(1, { predeterminada: true }))
    if (a.kind !== "ok") throw new Error("alta")
    expect(await actualizarCuenta(A, a.cuenta.id, { activa: false })).toEqual({
      kind: "invalid",
      campo: "activa",
      error: "Elija otra cuenta predeterminada antes de desactivar esta.",
    })
    // desmarcarla y desactivarla juntas sí
    expect(await actualizarCuenta(A, a.cuenta.id, { predeterminada: false, activa: false })).toMatchObject({ kind: "ok", cuenta: { activa: false, predeterminada: false } })
  })

  it("cambio parcial: pasar de 'todas' a elegir exige sucursales; el rango se valida contra lo guardado", async () => {
    const a = await crearCuenta(A, base(1, { montoMin: 100 }))
    if (a.kind !== "ok") throw new Error("alta")
    expect(await actualizarCuenta(A, a.cuenta.id, { todasLasSucursales: false })).toMatchObject({ kind: "invalid", campo: "sucursalSlugs" })
    expect(await actualizarCuenta(A, a.cuenta.id, { montoMax: 50 })).toMatchObject({ kind: "invalid", campo: "montoMin" })
    expect(await actualizarCuenta(A, a.cuenta.id, { todasLasSucursales: false, sucursalSlugs: ["mdp"] })).toMatchObject({
      kind: "ok",
      cuenta: { todasLasSucursales: false, sucursalSlugs: ["mdp"], montoMin: 100 },
    })
    // y a la inversa: 'todas' limpia la lista
    expect(await actualizarCuenta(A, a.cuenta.id, { todasLasSucursales: true })).toMatchObject({ kind: "ok", cuenta: { todasLasSucursales: true, sucursalSlugs: [] } })
  })

  it("una sucursal dada de baja después no rompe la lectura", async () => {
    await crearCuenta(A, base(1, { todasLasSucursales: false, sucursalSlugs: ["igz"] }))
    await getDb().execute(dsql`delete from sucursales where tenant_id = ${A} and slug = 'igz'`)
    expect(await listarCuentas(A)).toMatchObject([{ sucursalSlugs: ["igz"] }])
  })

  it("otro tenant → not_found al editar y al borrar; borra la propia", async () => {
    const a = await crearCuenta(A, base(1))
    if (a.kind !== "ok") throw new Error("alta")
    expect(await actualizarCuenta(B, a.cuenta.id, { activa: false })).toEqual({ kind: "not_found" })
    expect(await eliminarCuenta(B, a.cuenta.id)).toEqual({ kind: "not_found" })
    expect(await eliminarCuenta(A, a.cuenta.id)).toEqual({ kind: "ok" })
    expect(await eliminarCuenta(A, a.cuenta.id)).toEqual({ kind: "not_found" })
  })
})

describe("0055: GRANT por columna a shop_app", () => {
  let sql: postgres.Sql
  let rolCreadoAca = false

  /** El bloque de GRANTs tal cual está en la migración (último statement). */
  function bloqueDeGrants(): string {
    const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
    const bloque = partes[partes.length - 1]
    if (!/DO \$\$/.test(bloque)) throw new Error("no encontré el bloque DO $$ de los GRANTs")
    return bloque
  }

  const puede = async (columna: string) => {
    const [r] = await sql`select has_column_privilege('shop_app', 'public.cuentas_bancarias_shop', ${columna}, 'SELECT') as ok`
    return r.ok as boolean
  }

  it("lee las columnas del contrato y NO created_at / updated_at; sin escritura", async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      const existe = await sql`select 1 from pg_roles where rolname = 'shop_app'`
      if (existe.length === 0) {
        await sql.unsafe("create role shop_app nologin")
        rolCreadoAca = true
      }
      await sql.unsafe(bloqueDeGrants())

      for (const c of ["id", "tenant_id", "alias", "cbu", "banco", "titular", "cuit", "todas_las_sucursales", "sucursal_slugs", "monto_min", "monto_max", "activa", "predeterminada", "orden"]) {
        expect(await puede(c), c).toBe(true)
      }
      expect(await puede("created_at")).toBe(false)
      expect(await puede("updated_at")).toBe(false)
      const [w] = await sql`select has_table_privilege('shop_app', 'public.cuentas_bancarias_shop', 'INSERT') as i, has_table_privilege('shop_app', 'public.cuentas_bancarias_shop', 'UPDATE') as u, has_table_privilege('shop_app', 'public.cuentas_bancarias_shop', 'DELETE') as d`
      expect([w.i, w.u, w.d]).toEqual([false, false, false])
    } finally {
      if (rolCreadoAca) {
        await sql.unsafe("drop owned by shop_app")
        await sql.unsafe("drop role shop_app")
      }
      await sql.end()
    }
  })
})
