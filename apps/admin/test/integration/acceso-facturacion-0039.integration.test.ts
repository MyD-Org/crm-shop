import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0039 (change `clientes-tienda-admin`, R4a): excepción de acceso a Facturación por
 * CONTACTO (`contactos_acceso_facturacion`) y la columna `acceso_facturacion` al final de la
 * vista `alegra_contacts_shop` = cuenta corriente O excepción vigente.
 *
 * Como en shop-contactos-telefonos: en crm_test el rol `shop_app` no existe cuando el
 * global-setup migra, así que este test lo crea (NOLOGIN, sólo en el Postgres LOCAL de test),
 * corre el MISMO bloque de GRANTs de 0039 leído del .sql y verifica como `shop_app` dentro de
 * transacciones que siempre se revierten. Si creó el rol, lo borra al terminar.
 *
 * Datos inventados: tenants `tenant-caf` / `tenant-caf-b`, contactos de fantasía, `.example`.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0039_contactos_acceso_facturacion.sql", import.meta.url))
const TENANT = "tenant-caf"
const OTRO = "tenant-caf-b"
const ACTOR = "00000000-0000-4000-8000-000000000001"

function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0039: no encontré el bloque DO $$ de los GRANTs")
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

async function contacto(tenant: string, alegraId: string, opts: { corriente?: boolean; status?: string; cuenta?: string } = {}) {
  await sql`
    INSERT INTO alegra_contacts (tenant_id, alegra_account, alegra_id, name, types, payment_term_days, status, raw)
    VALUES (${tenant}, ${opts.cuenta ?? "principal"}, ${alegraId}, ${`Contacto ${alegraId}`}, ${["client"]},
            ${opts.corriente ? 30 : 0}, ${opts.status ?? "active"}, ${sql.json({ id: alegraId })})
  `
}

async function excepcion(
  tenant: string,
  alegraId: string,
  opts: { revocada?: boolean; cuenta?: string } = {},
) {
  await sql`
    INSERT INTO contactos_acceso_facturacion
      (tenant_id, alegra_account, alegra_id, otorgado_por, otorgado_por_nombre,
       revocado_por, revocado_por_nombre, revocado_en)
    VALUES (${tenant}, ${opts.cuenta ?? "principal"}, ${alegraId}, ${ACTOR}, 'Admin Ejemplo',
            ${opts.revocada ? ACTOR : null}, ${opts.revocada ? "Admin Ejemplo" : null},
            ${opts.revocada ? new Date() : null})
  `
}

async function acceso(tenant: string, alegraId: string): Promise<boolean | undefined> {
  const [f] = await sql`
    SELECT acceso_facturacion FROM alegra_contacts_shop
    WHERE tenant_id = ${tenant} AND alegra_account = 'principal' AND alegra_id = ${alegraId}
  `
  return f?.acceso_facturacion as boolean | undefined
}

async function limpiar() {
  await sql`DELETE FROM contactos_acceso_facturacion WHERE tenant_id IN (${TENANT}, ${OTRO})`
  await sql`DELETE FROM alegra_contacts WHERE tenant_id IN (${TENANT}, ${OTRO})`
}

describe("migración 0039: excepción de acceso a Facturación y columna en la vista (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())

    await limpiar()
    await sql`DELETE FROM tenants WHERE id IN (${TENANT}, ${OTRO})`
    for (const id of [TENANT, OTRO]) {
      await sql`
        INSERT INTO tenants (id, name, logo_path, resend_from)
        VALUES (${id}, 'Tenant CAF', '/logos/test.svg', 'no-responder@plataforma.example')
      `
    }
  })

  beforeEach(limpiar)

  afterAll(async () => {
    if (!sql) return
    await limpiar()
    await sql`DELETE FROM tenants WHERE id IN (${TENANT}, ${OTRO})`
    if (rolCreadoAca) {
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  describe("acceso_facturacion = cuenta corriente O excepción vigente", () => {
    it("cuenta corriente sin excepción ⇒ true", async () => {
      await contacto(TENANT, "11", { corriente: true })
      expect(await acceso(TENANT, "11")).toBe(true)
    })

    it("contado sin excepción ⇒ false", async () => {
      await contacto(TENANT, "12")
      expect(await acceso(TENANT, "12")).toBe(false)
    })

    it("contado con excepción vigente ⇒ true", async () => {
      await contacto(TENANT, "13")
      await excepcion(TENANT, "13")
      expect(await acceso(TENANT, "13")).toBe(true)
    })

    it("contado con excepción revocada ⇒ false", async () => {
      await contacto(TENANT, "14")
      await excepcion(TENANT, "14", { revocada: true })
      expect(await acceso(TENANT, "14")).toBe(false)
    })

    it("cuenta corriente con excepción revocada ⇒ true (manda la cuenta corriente)", async () => {
      await contacto(TENANT, "15", { corriente: true })
      await excepcion(TENANT, "15", { revocada: true })
      expect(await acceso(TENANT, "15")).toBe(true)
    })

    it("la excepción de otro tenant con el mismo alegra_id no cuenta", async () => {
      await contacto(TENANT, "16")
      await contacto(OTRO, "16")
      await excepcion(OTRO, "16")
      expect(await acceso(TENANT, "16")).toBe(false)
      expect(await acceso(OTRO, "16")).toBe(true)
    })

    it("la excepción de otra cuenta de Alegra del mismo tenant no cuenta", async () => {
      await contacto(TENANT, "17")
      await excepcion(TENANT, "17", { cuenta: "secundaria" })
      expect(await acceso(TENANT, "17")).toBe(false)
    })

    it("contacto inactivo conserva la columna: el filtro por status lo hace el lector", async () => {
      await contacto(TENANT, "18", { status: "inactive" })
      await excepcion(TENANT, "18")
      const [f] = await sql`
        SELECT status, acceso_facturacion FROM alegra_contacts_shop
        WHERE tenant_id = ${TENANT} AND alegra_id = '18'
      `
      expect({ ...f }).toEqual({ status: "inactive", acceso_facturacion: true })
    })

    it("nunca es NULL (contrato: boolean NOT NULL del lado del Shop)", async () => {
      await contacto(TENANT, "19")
      await contacto(TENANT, "20", { corriente: true })
      const [f] = await sql`
        SELECT count(*)::int AS nulos FROM alegra_contacts_shop
        WHERE tenant_id = ${TENANT} AND acceso_facturacion IS NULL
      `
      expect(f.nulos).toBe(0)
    })
  })

  describe("tabla contactos_acceso_facturacion", () => {
    it("el índice parcial impide dos excepciones vigentes del mismo contacto (23505)", async () => {
      await excepcion(TENANT, "30")
      await expect(excepcion(TENANT, "30")).rejects.toMatchObject({ code: "23505" })
    })

    it("sí admite varias revocadas más una vigente (historial)", async () => {
      await excepcion(TENANT, "31", { revocada: true })
      await excepcion(TENANT, "31", { revocada: true })
      await excepcion(TENANT, "31")
      const [f] = await sql`
        SELECT count(*)::int AS n FROM contactos_acceso_facturacion WHERE tenant_id = ${TENANT} AND alegra_id = '31'
      `
      expect(f.n).toBe(3)
    })

    it("CHECK caf_revocacion_completa: revocado_en sin revocado_por ⇒ 23514", async () => {
      await expect(sql`
        INSERT INTO contactos_acceso_facturacion (tenant_id, alegra_id, otorgado_por, otorgado_por_nombre, revocado_en)
        VALUES (${TENANT}, '32', ${ACTOR}, 'Admin Ejemplo', now())
      `).rejects.toMatchObject({ code: "23514" })
    })

    it("FK a tenants: tenant inexistente ⇒ 23503", async () => {
      await expect(excepcion("tenant-que-no-existe", "33")).rejects.toMatchObject({ code: "23503" })
    })
  })

  describe("permisos de shop_app", () => {
    it("lee acceso_facturacion de la vista", async () => {
      await contacto(TENANT, "40")
      await excepcion(TENANT, "40")
      const r = await comoShopApp(
        `SELECT alegra_id, acceso_facturacion FROM public.alegra_contacts_shop WHERE tenant_id = '${TENANT}'`,
      )
      if (!r.ok) throw new Error(`SELECT falló con ${r.code}`)
      expect(r.filas.map((f) => ({ ...f }))).toEqual([{ alegra_id: "40", acceso_facturacion: true }])
    })

    it("NO puede leer contactos_acceso_facturacion (42501)", async () => {
      expect(await comoShopApp("SELECT otorgado_por_nombre FROM public.contactos_acceso_facturacion")).toEqual({
        ok: false,
        code: "42501",
      })
    })

    it("has_table_privilege: SELECT sobre la vista sí, sobre la tabla nueva no", async () => {
      const [p] = await sql`
        SELECT has_table_privilege('shop_app', 'public.alegra_contacts_shop', 'SELECT') AS vista,
               has_table_privilege('shop_app', 'public.contactos_acceso_facturacion', 'SELECT') AS tabla
      `
      expect({ ...p }).toEqual({ vista: true, tabla: false })
    })

    it("el bloque de GRANTs es idempotente (se puede correr a mano otra vez)", async () => {
      await expect(sql.unsafe(bloqueDeGrants())).resolves.toBeDefined()
    })
  })
})
