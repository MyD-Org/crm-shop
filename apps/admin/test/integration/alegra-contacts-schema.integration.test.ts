import { describe, it, expect, beforeEach } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migraciones 0030 (tabla `alegra_contacts` + bitácora), 0031, 0032 y 0034 (vista para el Shop), contra
 * Postgres real. El global-setup ya las aplicó vía drizzle migrate.
 *
 * Datos inventados: tenants tenant-a/tenant-b, ids de Alegra de fantasía.
 */

/**
 * Regla canónica de cuenta corriente = columna generada `tipo_cuenta` (0030).
 *
 * COPIAR LITERAL al test de `tipoCuentaDe` del Shop (apps/clientes/src/lib/alegra.test.ts):
 * la función TS del Shop solo se usa para contactos leídos en vivo y tiene que dar lo mismo
 * que la columna.
 */
export const CASOS_TIPO_CUENTA: Array<{
  caso: string
  paymentTermDays: number | null
  creditLimit: string | null
  esperado: "corriente" | "contado"
}> = [
  { caso: "días 0 y sin límite", paymentTermDays: 0, creditLimit: null, esperado: "contado" },
  { caso: "sin días y sin límite", paymentTermDays: null, creditLimit: null, esperado: "contado" },
  { caso: "días 15", paymentTermDays: 15, creditLimit: null, esperado: "corriente" },
  { caso: "días 0 y límite 50000", paymentTermDays: 0, creditLimit: "50000", esperado: "corriente" },
  { caso: "sin días y límite 0", paymentTermDays: null, creditLimit: "0", esperado: "contado" },
]

type Fila = typeof alegraContacts.$inferInsert
function fila(tenantId: string, alegraId: string, extra: Partial<Fila> = {}): Fila {
  return { tenantId, alegraId, name: `Contacto ${alegraId}`, ...extra }
}

describe("migración 0030: alegra_contacts (DB real)", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant("tenant-a")
    await seedTenant("tenant-b")
  })

  it("las tablas existen y arrancan vacías", async () => {
    const r = await getDb().execute(sql`
      SELECT (SELECT count(*) FROM alegra_contacts)::int AS contactos,
             (SELECT count(*) FROM alegra_contacts_sync_log)::int AS corridas
    `)
    expect(r[0]).toEqual({ contactos: 0, corridas: 0 })
  })

  it.each(CASOS_TIPO_CUENTA)("tipo_cuenta generada: $caso → $esperado", async (c) => {
    const [row] = await getDb()
      .insert(alegraContacts)
      .values(fila("tenant-a", "1", { paymentTermDays: c.paymentTermDays, creditLimit: c.creditLimit }))
      .returning({ tipoCuenta: alegraContacts.tipoCuenta })
    expect(row.tipoCuenta).toBe(c.esperado)
  })

  it("tipo_cuenta se recalcula al actualizar las columnas de origen", async () => {
    const db = getDb()
    await db.insert(alegraContacts).values(fila("tenant-a", "1", { paymentTermDays: 0 }))
    const [row] = await db
      .update(alegraContacts)
      .set({ paymentTermDays: 30 })
      .where(and(eq(alegraContacts.tenantId, "tenant-a"), eq(alegraContacts.alegraId, "1")))
      .returning({ tipoCuenta: alegraContacts.tipoCuenta })
    expect(row.tipoCuenta).toBe("corriente")
  })

  it("unique (tenant, cuenta, alegra_id): el mismo id en otra cuenta o en otro tenant coexiste", async () => {
    const db = getDb()
    await db.insert(alegraContacts).values([
      fila("tenant-a", "7"),
      fila("tenant-a", "7", { alegraAccount: "franquicia" }),
      fila("tenant-b", "7"),
    ])
    await expect(db.insert(alegraContacts).values(fila("tenant-a", "7"))).rejects.toThrow()
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM alegra_contacts WHERE alegra_id = '7'`)
    expect(r[0].n).toBe(3)
  })

  it("defaults: cuenta 'principal', status 'active', origen 'sync', arrays vacíos", async () => {
    const [row] = await getDb().insert(alegraContacts).values(fila("tenant-a", "1")).returning()
    expect(row.alegraAccount).toBe("principal")
    expect(row.status).toBe("active")
    expect(row.origen).toBe("sync")
    expect(row.emailsNorm).toEqual([])
    expect(row.phonesNorm).toEqual([])
    expect(row.types).toEqual([])
  })
})

describe("migraciones 0031 + 0032 + 0034 + 0036: vista alegra_contacts_shop (DB real)", () => {
  const columnasDeLaVista = async () => {
    const r = await getDb().execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'alegra_contacts_shop'
      ORDER BY ordinal_position
    `)
    return r.map((x) => x.column_name as string)
  }

  // 0031 expuso 16 columnas; 0032 (change portal-al-shop) sumó al final vendedor, plazo y límite
  // para Condiciones y la barra de límite de crédito de "Mi cuenta" del Shop; 0034
  // (change contacto-fuente-unica) sumó al final las 7 de facturación generadas desde raw; 0036
  // sumó al final los 3 teléfonos (el Shop no vuelve a pedir lo que el espejo ya tiene).
  it("expone exactamente las 30 columnas del contrato con el Shop", async () => {
    expect(await columnasDeLaVista()).toEqual([
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
    ])
  })

  it("no expone el crudo, los teléfonos normalizados ni ids internos de vendedor/plazo", async () => {
    const cols = await columnasDeLaVista()
    for (const oculta of [
      "raw",
      "phones_norm",
      "seller_id",
      "payment_term_id",
      "origen",
    ]) {
      expect(cols).not.toContain(oculta)
    }
  })

  it("refleja las filas de la tabla, con tipo_cuenta ya calculada", async () => {
    await truncateAll()
    await seedTenant("tenant-a")
    await getDb().insert(alegraContacts).values(fila("tenant-a", "9", { paymentTermDays: 30 }))
    const r = await getDb().execute(
      sql`SELECT alegra_id, tipo_cuenta FROM alegra_contacts_shop WHERE tenant_id = 'tenant-a'`,
    )
    expect(r.map((x) => ({ ...x }))).toEqual([{ alegra_id: "9", tipo_cuenta: "corriente" }])
  })
})

/**
 * Migración 0034 (change `contacto-fuente-unica`): 7 columnas GENERADAS desde `raw` con los
 * datos de facturación. Vacío, espacios, clave ausente, forma inesperada o raw NULL ⇒ NULL.
 */
describe("migración 0034: columnas de facturación generadas desde raw (DB real)", () => {
  const COLUMNAS = `iva_condition, identification_type, identification_number, address_street,
                    address_city, address_province, address_postal_code`

  async function generadas(raw: unknown): Promise<Record<string, unknown>> {
    await truncateAll()
    await seedTenant("tenant-a")
    const r = await getDb().execute(sql`
      INSERT INTO alegra_contacts (tenant_id, alegra_id, name, raw)
      VALUES ('tenant-a', '1', 'Contacto 1', ${raw === null ? null : JSON.stringify(raw)}::jsonb)
      RETURNING ${sql.raw(COLUMNAS)}
    `)
    return { ...r[0] }
  }

  const TODO_NULL = {
    iva_condition: null,
    identification_type: null,
    identification_number: null,
    address_street: null,
    address_city: null,
    address_province: null,
    address_postal_code: null,
  }

  it("contacto completo: valores tal cual (sin espacios de borde)", async () => {
    expect(
      await generadas({
        id: 1,
        ivaCondition: "IVA_RESPONSABLE",
        identificationObject: { type: "CUIT", number: " 20-12345678-9 " },
        address: { address: "Calle Falsa 123", city: "Ciudad Ejemplo", province: "Córdoba", postalCode: "5000" },
      }),
    ).toEqual({
      iva_condition: "IVA_RESPONSABLE",
      identification_type: "CUIT",
      identification_number: "20-12345678-9",
      address_street: "Calle Falsa 123",
      address_city: "Ciudad Ejemplo",
      address_province: "Córdoba",
      address_postal_code: "5000",
    })
  })

  it('"" y espacios → NULL', async () => {
    expect(
      await generadas({
        ivaCondition: "",
        identificationObject: { type: "  ", number: "" },
        address: { address: "", city: " ", province: "", postalCode: "   " },
      }),
    ).toEqual(TODO_NULL)
  })

  it("claves ausentes → NULL", async () => {
    expect(await generadas({ id: 1, name: "x" })).toEqual(TODO_NULL)
  })

  it("address o identificationObject escalares → NULL (no error)", async () => {
    expect(await generadas({ address: "Calle suelta 1", identificationObject: "CUIT" })).toEqual(TODO_NULL)
  })

  it("raw NULL → NULL", async () => {
    expect(await generadas(null)).toEqual(TODO_NULL)
  })

  it("un UPDATE de raw recalcula las columnas", async () => {
    await generadas({ ivaCondition: "" })
    const r = await getDb().execute(sql`
      UPDATE alegra_contacts SET raw = '{"ivaCondition":"IVA_EXEMPT","address":{"city":"Otra"}}'::jsonb
      WHERE tenant_id = 'tenant-a' AND alegra_id = '1'
      RETURNING iva_condition, address_city
    `)
    expect({ ...r[0] }).toEqual({ iva_condition: "IVA_EXEMPT", address_city: "Otra" })
  })
})
