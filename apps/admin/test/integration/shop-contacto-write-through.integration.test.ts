import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { mapRawContactRow } from "@/lib/alegra"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0034 (change `contacto-fuente-unica`): función `public.shop_contacto_write_through`
 * y permisos del rol `shop_app` sobre la vista con las columnas de facturación.
 *
 * Como en shop-cuenta-corriente-grants: en crm_test el rol no existe cuando el global-setup
 * migra, así que este test lo crea (NOLOGIN, sólo en el Postgres LOCAL de test), corre el MISMO
 * bloque de GRANTs leído del .sql y verifica como `shop_app`. Cada caso corre en una
 * transacción que SIEMPRE se revierte. Si los roles los creó este test, los borra al terminar.
 *
 * Datos inventados: tenants `tenant-wt` / `tenant-wt-otro`, contactos de fantasía, `.example`.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0034_contacto_fuente_unica.sql", import.meta.url))
const FN = "public.shop_contacto_write_through(text,text,text,jsonb)"
const OTRO_ROL = "crm_test_sin_execute"

/** El bloque de GRANTs tal cual está en la migración (último statement). */
function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0034: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

/** Contacto base como lo devuelve Alegra: RI con CUIT y ciudad, SIN calle ni provincia. */
const BASE = {
  id: 501,
  name: "Cliente de Fantasía SRL",
  identification: "30-71234567-8",
  identificationObject: { type: "CUIT", number: "30-71234567-8" },
  ivaCondition: "IVA_RESPONSABLE",
  address: { address: "", city: "Ciudad Ejemplo", province: "", postalCode: "1000" },
  email: "compras@cliente.example",
}
/** Contacto sin documento ni condición (para llenar esos vacíos). */
const SIN_DOC = { id: "502", name: "Consumidor de Fantasía", ivaCondition: "", address: { city: "Otra Ciudad" } }

const conCambios = (base: Record<string, unknown>, cambios: Record<string, unknown>) => ({ ...base, ...cambios })
const conDomicilio = (cambios: Record<string, unknown>) =>
  conCambios(BASE, { address: { ...BASE.address, ...cambios } })

let sql: postgres.Sql
const rolesCreadosAca: string[] = []

type Resultado = { ok: true; filas: postgres.Row[] } | { ok: false; code: string }

/**
 * Corre `stmt` como `rol` y, ya como owner, `despues` (para leer cómo quedó la fila), dentro de
 * una transacción que SIEMPRE se revierte.
 */
async function como(
  rol: string,
  stmt: string,
  params: postgres.ParameterOrJSON<never>[] = [],
  despues?: string,
): Promise<{ r: Resultado; filasDespues: postgres.Row[] }> {
  let r: Resultado | null = null
  let filasDespues: postgres.Row[] = []
  const ROLLBACK = new Error("rollback")
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${rol}`)
      try {
        r = { ok: true, filas: [...(await tx.unsafe(stmt, params))] }
      } catch (e) {
        r = { ok: false, code: (e as { code?: string }).code ?? "?" }
      }
      if (despues) {
        await tx.unsafe("RESET ROLE")
        filasDespues = [...(await tx.unsafe(despues))]
      }
      throw ROLLBACK
    })
  } catch (e) {
    if (e !== ROLLBACK) throw e
  }
  if (!r) throw new Error("como: sin resultado")
  return { r, filasDespues }
}

const LLAMADA = `SELECT public.shop_contacto_write_through($1, $2, $3, $4::jsonb) AS resultado`
const FILAS_WT = `
  SELECT tenant_id, alegra_id, name, identification, identification_norm, origen, synced_at, raw,
         iva_condition, identification_type, identification_number,
         address_street, address_city, address_province, address_postal_code
  FROM public.alegra_contacts WHERE tenant_id IN ('tenant-wt', 'tenant-wt-otro') ORDER BY tenant_id, alegra_id`

/** Llama la función como shop_app y devuelve su resultado y cómo quedaron las filas. */
async function writeThrough(tenant: string, alegraId: string, raw: unknown, cuenta = "principal") {
  const { r, filasDespues } = await como("shop_app", LLAMADA, [tenant, cuenta, alegraId, raw as never], FILAS_WT)
  if (!r.ok) throw new Error(`write-through falló con ${r.code}`)
  return { resultado: r.filas[0].resultado as string, filas: filasDespues }
}

let filasIniciales: postgres.Row[]
const fila = (filas: postgres.Row[], tenant: string, id: string) =>
  filas.find((f) => f.tenant_id === tenant && f.alegra_id === id)

const SIN_PERMISO = { ok: false, code: "42501" }

describe("migración 0034: shop_contacto_write_through y permisos de shop_app (DB real)", () => {
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
    await sql.unsafe(bloqueDeGrants())
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${OTRO_ROL}`)

    await sql`DELETE FROM alegra_contacts WHERE tenant_id IN ('tenant-wt', 'tenant-wt-otro')`
    await sql`DELETE FROM tenants WHERE id IN ('tenant-wt', 'tenant-wt-otro')`
    for (const id of ["tenant-wt", "tenant-wt-otro"]) {
      await sql`
        INSERT INTO tenants (id, name, logo_path, resend_from)
        VALUES (${id}, 'Tenant WT', '/logos/test.svg', 'no-responder@plataforma.example')
      `
    }
    // Filas como las deja la sync (mapRawContactRow), con synced_at viejo para ver que cambia.
    for (const [tenant, raw] of [
      ["tenant-wt", BASE],
      ["tenant-wt", SIN_DOC],
      ["tenant-wt-otro", BASE],
    ] as const) {
      const f = mapRawContactRow(raw)
      await sql`
        INSERT INTO alegra_contacts (tenant_id, alegra_id, name, identification, identification_norm,
                                     email, raw, synced_at)
        VALUES (${tenant}, ${f.alegraId}, ${f.name}, ${f.identification}, ${f.identificationNorm},
                ${f.email}, ${sql.json(raw)}, '2020-01-01T00:00:00Z')
      `
    }
    filasIniciales = [...(await sql.unsafe(FILAS_WT))]
  })

  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM alegra_contacts WHERE tenant_id IN ('tenant-wt', 'tenant-wt-otro')`
    await sql`DELETE FROM tenants WHERE id IN ('tenant-wt', 'tenant-wt-otro')`
    for (const rol of rolesCreadosAca) {
      // DROP OWNED revoca lo concedido en ESTA base (el rol recién creado no tiene nada en otras).
      await sql.unsafe(`DROP OWNED BY ${rol}`)
      await sql.unsafe(`DROP ROLE ${rol}`)
    }
    await sql.end()
  })

  describe("completa vacíos ⇒ 'ok'", () => {
    it("llena la calle: columnas generadas, origen y synced_at al día; el resto intacto", async () => {
      const { resultado, filas } = await writeThrough("tenant-wt", "501", conDomicilio({ address: "Calle Falsa 123" }))
      expect(resultado).toBe("ok")
      const f = fila(filas, "tenant-wt", "501")!
      expect(f.address_street).toBe("Calle Falsa 123")
      expect(f.address_city).toBe("Ciudad Ejemplo")
      expect(f.iva_condition).toBe("IVA_RESPONSABLE")
      expect(f.origen).toBe("write_through")
      expect(new Date(f.synced_at).getTime()).toBeGreaterThan(new Date("2020-01-02").getTime())
      // La misma fila en otro tenant no se toca.
      expect(fila(filas, "tenant-wt-otro", "501")).toEqual(fila(filasIniciales, "tenant-wt-otro", "501"))
    })

    it('llena la provincia vacía con "Ciudad Autónoma de Buenos Aires"', async () => {
      const { resultado, filas } = await writeThrough(
        "tenant-wt",
        "501",
        conDomicilio({ province: "Ciudad Autónoma de Buenos Aires" }),
      )
      expect(resultado).toBe("ok")
      expect(fila(filas, "tenant-wt", "501")!.address_province).toBe("Ciudad Autónoma de Buenos Aires")
    })

    it("mismos valores presentes (con espacios de borde) + un vacío llenado ⇒ 'ok'", async () => {
      const raw = conCambios(conDomicilio({ address: "Calle Falsa 123" }), { name: ` ${BASE.name} ` })
      expect((await writeThrough("tenant-wt", "501", raw)).resultado).toBe("ok")
    })

    it("identification_norm igual al que produce la sync para 20-12345678-9", async () => {
      const raw = conCambios(SIN_DOC, {
        identification: "20-12345678-9",
        identificationObject: { type: "CUIT", number: "20-12345678-9" },
        ivaCondition: "FINAL_CONSUMER",
      })
      const { resultado, filas } = await writeThrough("tenant-wt", "502", raw)
      expect(resultado).toBe("ok")
      const f = fila(filas, "tenant-wt", "502")!
      const sync = mapRawContactRow(raw)
      expect(f.identification).toBe(sync.identification)
      expect(f.identification_norm).toBe(sync.identificationNorm)
      expect(f.identification_norm).toBe("20123456789")
      expect(f.identification_type).toBe("CUIT")
      expect(f.iva_condition).toBe("FINAL_CONSUMER")
    })

    it("identification como objeto { number }: misma lógica que la sync", async () => {
      const raw = conCambios(SIN_DOC, { identification: { type: "DNI", number: "12345678" } })
      const { resultado, filas } = await writeThrough("tenant-wt", "502", raw)
      expect(resultado).toBe("ok")
      const f = fila(filas, "tenant-wt", "502")!
      expect(f.identification).toBe(mapRawContactRow(raw).identification)
      expect(f.identification_norm).toBe(mapRawContactRow(raw).identificationNorm)
    })
  })

  describe("nunca inserta ⇒ 'sin_fila'", () => {
    it.each([
      ["tenant ajeno", "tenant-inexistente", "501", "principal"],
      ["id inexistente", "tenant-wt", "999", "principal"],
      ["otra cuenta de Alegra", "tenant-wt", "501", "franquicia"],
    ])("%s", async (_caso, tenant, id, cuenta) => {
      const raw = conCambios(conDomicilio({ address: "Calle Falsa 123" }), { id })
      const { resultado, filas } = await writeThrough(tenant, id, raw, cuenta)
      expect(resultado).toBe("sin_fila")
      expect(filas).toEqual(filasIniciales)
    })
  })

  describe("pisar o borrar un dato presente ⇒ 'rechazado' y fila intacta", () => {
    it.each([
      ["id del contacto distinto del pedido", conCambios(BASE, { id: 777 })],
      ["contacto sin id", conCambios(BASE, { id: null })],
      ["nombre vacío", conCambios(BASE, { name: " " })],
      ["otro nombre", conCambios(BASE, { name: "Otra Razón Social SA" })],
      ["otro número de documento", conCambios(BASE, { identificationObject: { type: "CUIT", number: "20-12345678-9" } })],
      ["otra identification", conCambios(BASE, { identification: "20-12345678-9" })],
      ["otro tipo de documento", conCambios(BASE, { identificationObject: { type: "DNI", number: "30-71234567-8" } })],
      ["otra condición de IVA", conCambios(BASE, { ivaCondition: "FINAL_CONSUMER" })],
      ["condición de IVA borrada", conCambios(BASE, { ivaCondition: "" })],
      ["otra ciudad", conDomicilio({ city: "Otra Ciudad" })],
      ["ciudad borrada (clave ausente)", conCambios(BASE, { address: { address: "Calle Falsa 123" } })],
      ["otro CP", conDomicilio({ postalCode: "2000" })],
      ["llena la calle pero pisa la ciudad", conDomicilio({ address: "Calle Falsa 123", city: "Otra" })],
    ])("%s", async (_caso, raw) => {
      const { resultado, filas } = await writeThrough("tenant-wt", "501", raw)
      expect(resultado).toBe("rechazado")
      expect(filas).toEqual(filasIniciales)
    })

    it.each([
      ["raw no es un objeto", []],
      ["raw NULL", null],
    ])("%s", async (_caso, raw) => {
      const { r, filasDespues } = await como(
        "shop_app",
        LLAMADA,
        ["tenant-wt", "principal", "501", raw as never],
        FILAS_WT,
      )
      expect(r).toEqual({ ok: true, filas: [{ resultado: "rechazado" }] })
      expect(filasDespues).toEqual(filasIniciales)
    })
  })

  describe("permisos", () => {
    it("PUBLIC no puede ejecutarla; shop_app sí", async () => {
      const [p] = await sql`
        SELECT has_function_privilege('public', ${FN}, 'EXECUTE') AS publico,
               has_function_privilege('shop_app', ${FN}, 'EXECUTE') AS shop_app
      `
      expect({ ...p }).toEqual({ publico: false, shop_app: true })
    })

    it("otro rol sin EXECUTE ⇒ 42501", async () => {
      const { r } = await como(OTRO_ROL, LLAMADA, ["tenant-wt", "principal", "501", BASE as never])
      expect(r).toEqual(SIN_PERMISO)
    })

    it("shop_app sigue sin UPDATE directo sobre la tabla", async () => {
      const { r } = await como("shop_app", "UPDATE public.alegra_contacts SET name = 'x'")
      expect(r).toEqual(SIN_PERMISO)
    })

    it("shop_app no lee raw de la tabla, y la vista no lo expone", async () => {
      expect((await como("shop_app", "SELECT raw FROM public.alegra_contacts")).r).toEqual(SIN_PERMISO)
      expect((await como("shop_app", "SELECT raw FROM public.alegra_contacts_shop")).r).toEqual({
        ok: false,
        code: "42703",
      })
    })

    it("shop_app lee de la vista exactamente las 31 columnas del contrato (0036 sumó teléfonos, 0039 el acceso)", async () => {
      const { r } = await como("shop_app", "SELECT * FROM public.alegra_contacts_shop WHERE tenant_id = 'tenant-wt' AND alegra_id = '501'")
      if (!r.ok) throw new Error(`SELECT falló con ${r.code}`)
      expect(Object.keys(r.filas[0])).toEqual([
        "tenant_id",
        "alegra_account",
        "alegra_id",
        "name",
        "identification",
        "identification_norm",
        "email",
        "emails_norm",
        "types",
        "price_list_id",
        "price_list_name",
        "price_list_status",
        "tipo_cuenta",
        "alegra_status",
        "status",
        "synced_at",
        "seller_name",
        "payment_term_name",
        "payment_term_days",
        "credit_limit",
        "iva_condition",
        "identification_type",
        "identification_number",
        "address_street",
        "address_city",
        "address_province",
        "address_postal_code",
        "phone_primary",
        "phone_secondary",
        "mobile",
        "acceso_facturacion",
      ])
      expect(r.filas[0].address_city).toBe("Ciudad Ejemplo")
      expect(r.filas[0].address_street).toBeNull()
    })

    it("el bloque de GRANTs es idempotente (se puede correr a mano otra vez)", async () => {
      await expect(sql.unsafe(bloqueDeGrants())).resolves.toBeDefined()
    })
  })
})
