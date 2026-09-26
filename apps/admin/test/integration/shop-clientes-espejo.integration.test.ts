import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0018 del Shop (change `clientes-tienda-admin`, R1): espejo de usuarios de Clerk en
 * `shop.clientes` y las funciones `shop.clientes_upsert_clerk` / `shop.clientes_eliminar_clerk`
 * que usan el webhook y el backfill del Shop.
 *
 * El Shop no tiene tests con base: esta suite (que ya aplica las migraciones REALES del Shop a
 * crm_test en el global-setup) es la que prueba el contrato contra Postgres de verdad — orden de
 * eventos, idempotencia, anonimización en la baja y permisos de `shop_app`.
 *
 * Como en shop-cuenta-corriente-grants: el rol `shop_app` no existe cuando el global-setup migra,
 * así que el test lo crea (NOLOGIN, sólo en el Postgres LOCAL de test), le da el USAGE del esquema
 * que tiene en prod (runbook de una-base-esquema-shop.md) y corre el MISMO bloque de GRANTs leído
 * del .sql. Si lo creó este test, lo borra al terminar.
 *
 * Datos inventados: tenants `tenant-sc` / `tenant-sc-otro`, usuarios `user_test*`, `.example`.
 */

const MIGRACION = fileURLToPath(new URL("../../../clientes/drizzle/0018_clientes_espejo_clerk.sql", import.meta.url))
const UPSERT = "shop.clientes_upsert_clerk(text,text,text,text,timestamptz,timestamptz)"
const ELIMINAR = "shop.clientes_eliminar_clerk(text,text)"
const OTRO_ROL = "crm_test_sin_execute_sc"
const TENANTS = ["tenant-sc", "tenant-sc-otro"]

/** El bloque de GRANTs tal cual está en la migración (último statement). */
function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0018: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

let sql: postgres.Sql
const rolesCreadosAca: string[] = []

const T1 = "2026-09-01T10:00:00Z"
const T2 = "2026-09-02T10:00:00Z"
const T0 = "2026-08-31T10:00:00Z"

async function upsert(
  tenant: string | null,
  id: string | null,
  email: string | null,
  nombre: string | null,
  actualizado: string | null,
  creado: string | null = T0,
): Promise<string> {
  const [f] = await sql`
    SELECT shop.clientes_upsert_clerk(${tenant}, ${id}, ${email}, ${nombre}, ${creado}::timestamptz, ${actualizado}::timestamptz) AS r`
  return f.r as string
}

async function eliminar(tenant: string, id: string): Promise<string> {
  const [f] = await sql`SELECT shop.clientes_eliminar_clerk(${tenant}, ${id}) AS r`
  return f.r as string
}

async function filas(id: string) {
  return sql`
    SELECT tenant_id, clerk_user_id, email, email_norm, nombre, creado_en_clerk, actualizado_en_clerk, eliminado_en
    FROM shop.clientes WHERE clerk_user_id = ${id} ORDER BY tenant_id`
}

type Resultado = { ok: true; filas: postgres.Row[] } | { ok: false; code: string }

/** Corre `stmt` como `rol` en una transacción que SIEMPRE se revierte. */
async function como(rol: string, stmt: string): Promise<Resultado> {
  let r: Resultado | null = null
  const ROLLBACK = new Error("rollback")
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${rol}`)
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
  if (!r) throw new Error("como: sin resultado")
  return r
}

describe("migración 0018 del Shop: espejo de usuarios de Clerk (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    for (const rol of ["shop_app", OTRO_ROL]) {
      const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${rol}`
      if (existe.length === 0) {
        await sql.unsafe(`CREATE ROLE ${rol} NOLOGIN`)
        rolesCreadosAca.push(rol)
      }
    }
    // Lo que el runbook le da a shop_app en prod al crear el esquema (no es parte de la 0018).
    await sql.unsafe("GRANT USAGE ON SCHEMA shop TO shop_app")
    await sql.unsafe(`GRANT USAGE ON SCHEMA shop TO ${OTRO_ROL}`)
    await sql.unsafe(bloqueDeGrants())
  })

  beforeEach(async () => {
    await sql`DELETE FROM shop.clientes WHERE tenant_id IN ${sql(TENANTS)}`
  })

  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM shop.clientes WHERE tenant_id IN ${sql(TENANTS)}`
    for (const rol of rolesCreadosAca) {
      // DROP OWNED revoca lo concedido en ESTA base (el rol recién creado no tiene nada en otras).
      await sql.unsafe(`DROP OWNED BY ${rol}`)
      await sql.unsafe(`DROP ROLE ${rol}`)
    }
    await sql.end()
  })

  describe("clientes_upsert_clerk", () => {
    it("alta nueva ⇒ 'insertado' con email normalizado, nombre y fechas de Clerk", async () => {
      expect(await upsert("tenant-sc", "user_test1", " Ana@Cliente.Example ", " Ana Pérez ", T1)).toBe("insertado")
      const [f] = await filas("user_test1")
      expect(f).toMatchObject({
        tenant_id: "tenant-sc",
        email: "Ana@Cliente.Example",
        email_norm: "ana@cliente.example",
        nombre: "Ana Pérez",
        eliminado_en: null,
      })
      expect(new Date(f.creado_en_clerk).toISOString()).toBe(new Date(T0).toISOString())
      expect(new Date(f.actualizado_en_clerk).toISOString()).toBe(new Date(T1).toISOString())
    })

    it("updated_at mayor ⇒ 'actualizado' y pisa email/nombre; conserva el alta", async () => {
      await upsert("tenant-sc", "user_test1", "viejo@cliente.example", "Viejo", T1)
      expect(await upsert("tenant-sc", "user_test1", "nuevo@cliente.example", "Nuevo", T2, T1)).toBe("actualizado")
      const [f] = await filas("user_test1")
      expect(f).toMatchObject({ email: "nuevo@cliente.example", nombre: "Nuevo" })
      expect(new Date(f.creado_en_clerk).toISOString()).toBe(new Date(T0).toISOString())
      expect(new Date(f.actualizado_en_clerk).toISOString()).toBe(new Date(T2).toISOString())
    })

    it("updated_at menor (evento fuera de orden) ⇒ 'ignorado' y conserva los datos", async () => {
      await upsert("tenant-sc", "user_test1", "nuevo@cliente.example", "Nuevo", T2)
      expect(await upsert("tenant-sc", "user_test1", "viejo@cliente.example", "Viejo", T1)).toBe("ignorado")
      const [f] = await filas("user_test1")
      expect(f).toMatchObject({ email: "nuevo@cliente.example", nombre: "Nuevo" })
    })

    it("update antes que create: queda una sola fila con los datos del update", async () => {
      await upsert("tenant-sc", "user_test1", "nuevo@cliente.example", "Nuevo", T2)
      expect(await upsert("tenant-sc", "user_test1", "alta@cliente.example", "Alta", T1)).toBe("ignorado")
      const todas = await filas("user_test1")
      expect(todas).toHaveLength(1)
      expect(todas[0].email).toBe("nuevo@cliente.example")
    })

    it("mismo updated_at (re-entrega) ⇒ idempotente, una sola fila", async () => {
      await upsert("tenant-sc", "user_test1", "ana@cliente.example", "Ana", T1)
      expect(await upsert("tenant-sc", "user_test1", "ana@cliente.example", "Ana", T1)).toBe("actualizado")
      const todas = await filas("user_test1")
      expect(todas).toHaveLength(1)
      expect(todas[0]).toMatchObject({ email: "ana@cliente.example", nombre: "Ana" })
    })

    it("sin email ni nombre ⇒ fila con nulls (vacíos también quedan null)", async () => {
      expect(await upsert("tenant-sc", "user_test1", null, "  ", T1)).toBe("insertado")
      const [f] = await filas("user_test1")
      expect(f).toMatchObject({ email: null, email_norm: null, nombre: null })
    })

    it("mismo usuario en dos tenants ⇒ dos filas que no se pisan", async () => {
      await upsert("tenant-sc", "user_test1", "a@cliente.example", "A", T1)
      await upsert("tenant-sc-otro", "user_test1", "b@cliente.example", "B", T2)
      const todas = await filas("user_test1")
      expect(todas.map((f) => [f.tenant_id, f.email])).toEqual([
        ["tenant-sc", "a@cliente.example"],
        ["tenant-sc-otro", "b@cliente.example"],
      ])
    })

    it.each([
      ["tenant", [null, "user_test1", T1]],
      ["usuario", ["tenant-sc", null, T1]],
      ["updated_at", ["tenant-sc", "user_test1", null]],
    ] as const)("sin %s ⇒ 'rechazado' y no escribe", async (_n, [tenant, id, act]) => {
      expect(await upsert(tenant, id, "a@cliente.example", "A", act)).toBe("rechazado")
      expect(await sql`SELECT 1 FROM shop.clientes WHERE tenant_id IN ${sql(TENANTS)}`).toHaveLength(0)
    })
  })

  describe("clientes_eliminar_clerk", () => {
    it("baja ⇒ 'eliminado', anonimiza y marca eliminado_en; la fila sigue", async () => {
      await upsert("tenant-sc", "user_test1", "ana@cliente.example", "Ana", T1)
      expect(await eliminar("tenant-sc", "user_test1")).toBe("eliminado")
      const [f] = await filas("user_test1")
      expect(f).toMatchObject({ email: null, email_norm: null, nombre: null })
      expect(f.eliminado_en).not.toBeNull()
    })

    it("baja repetida conserva la fecha de la primera", async () => {
      await eliminar("tenant-sc", "user_test1")
      const [antes] = await filas("user_test1")
      await eliminar("tenant-sc", "user_test1")
      const [despues] = await filas("user_test1")
      expect(new Date(despues.eliminado_en).getTime()).toBe(new Date(antes.eliminado_en).getTime())
    })

    it("baja de un usuario desconocido ⇒ tombstone sin PII", async () => {
      expect(await eliminar("tenant-sc", "user_test2")).toBe("eliminado")
      const [f] = await filas("user_test2")
      expect(f).toMatchObject({ email: null, nombre: null })
      expect(f.eliminado_en).not.toBeNull()
    })

    it("upsert posterior a la baja (aun con updated_at más nuevo) ⇒ 'ignorado', sin PII", async () => {
      await upsert("tenant-sc", "user_test1", "ana@cliente.example", "Ana", T1)
      await eliminar("tenant-sc", "user_test1")
      expect(await upsert("tenant-sc", "user_test1", "ana@cliente.example", "Ana", T1)).toBe("ignorado")
      expect(await upsert("tenant-sc", "user_test1", "ana@cliente.example", "Ana", "2099-01-01T00:00:00Z")).toBe(
        "ignorado",
      )
      const [f] = await filas("user_test1")
      expect(f).toMatchObject({ email: null, email_norm: null, nombre: null })
    })

    it("la baja de un tenant no toca la fila del otro", async () => {
      await upsert("tenant-sc", "user_test1", "a@cliente.example", "A", T1)
      await upsert("tenant-sc-otro", "user_test1", "b@cliente.example", "B", T1)
      await eliminar("tenant-sc", "user_test1")
      const [, otro] = await filas("user_test1")
      expect(otro).toMatchObject({ tenant_id: "tenant-sc-otro", email: "b@cliente.example", eliminado_en: null })
    })

    it("el CHECK impide dejar PII en una fila eliminada", async () => {
      await eliminar("tenant-sc", "user_test1")
      await expect(
        sql`UPDATE shop.clientes SET email = 'x@cliente.example' WHERE clerk_user_id = 'user_test1'`,
      ).rejects.toMatchObject({ code: "23514" })
    })
  })

  describe("permisos", () => {
    it("shop_app puede ejecutar las dos funciones", async () => {
      const [f] = await sql`
        SELECT has_function_privilege('shop_app', ${UPSERT}, 'EXECUTE') AS u,
               has_function_privilege('shop_app', ${ELIMINAR}, 'EXECUTE') AS e`
      expect(f).toEqual({ u: true, e: true })
    })

    it("PUBLIC no: un rol sin GRANT recibe 42501", async () => {
      expect(
        await como(OTRO_ROL, "SELECT shop.clientes_upsert_clerk('tenant-sc','user_test1',null,null,now(),now())"),
      ).toEqual({ ok: false, code: "42501" })
      expect(await como(OTRO_ROL, "SELECT shop.clientes_eliminar_clerk('tenant-sc','user_test1')")).toEqual({
        ok: false,
        code: "42501",
      })
    })

    it("como shop_app el upsert y la baja funcionan (SECURITY INVOKER + GRANT de la tabla)", async () => {
      const r = await como(
        "shop_app",
        "SELECT shop.clientes_upsert_clerk('tenant-sc','user_test9','ana@cliente.example','Ana',now(),now()) AS r",
      )
      expect(r).toEqual({ ok: true, filas: [{ r: "insertado" }] })
      expect(await como("shop_app", "SELECT shop.clientes_eliminar_clerk('tenant-sc','user_test9') AS r")).toEqual({
        ok: true,
        filas: [{ r: "eliminado" }],
      })
    })

    it("shop_app no borra filas del espejo", async () => {
      const [f] = await sql`SELECT has_table_privilege('shop_app', 'shop.clientes', 'DELETE') AS d`
      // En crm_test no hay DEFAULT PRIVILEGES del runbook: el único GRANT es el de la 0018, sin DELETE.
      expect(f.d).toBe(false)
    })

    it("el bloque de GRANTs es idempotente (se puede correr a mano otra vez)", async () => {
      await expect(sql.unsafe(bloqueDeGrants())).resolves.toBeDefined()
    })
  })
})
