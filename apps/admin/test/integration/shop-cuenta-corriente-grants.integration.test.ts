import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0032 (change `portal-al-shop`): permisos del rol `shop_app` sobre `public`.
 *
 * En crm_test el rol no existe cuando el global-setup migra, así que el bloque `DO $$ … $$`
 * de la migración no concede nada. Este test crea el rol (NOLOGIN, sólo en el Postgres LOCAL
 * de test), corre el MISMO bloque leído del .sql (no una copia) y verifica, como `shop_app`,
 * lo que puede y lo que no. Si el rol lo creó este test, lo borra al terminar.
 *
 * Datos inventados: tenant `tenant-cc`, contacto de Alegra de fantasía, dominio `.example`.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0032_shop_cuenta_corriente.sql", import.meta.url))

/** El bloque de GRANTs tal cual está en la migración (último statement). */
function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0032: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

let sql: postgres.Sql
let rolCreadoAca = false

type Resultado = { ok: true; filas: number } | { ok: false; code: string }

/**
 * Corre `stmt` como `shop_app` dentro de una transacción que SIEMPRE se revierte: ni las
 * escrituras permitidas quedan en la base.
 */
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

const SIN_PERMISO = { ok: false, code: "42501" }

describe("migración 0032: permisos de shop_app para la cuenta corriente (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })

    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())

    // Datos mínimos (se borran en afterAll).
    await sql`DELETE FROM payment_receipts WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM notification_log WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM client_commercial_conditions WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM alegra_contacts WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM tenants WHERE id = 'tenant-cc'`
    await sql`
      INSERT INTO tenants (id, name, logo_path, resend_from, whatsapp_number, receipts_email, alegra_token)
      VALUES ('tenant-cc', 'Tenant CC', '/logos/test.svg', 'no-responder@plataforma.example',
              '5490000000000', 'cobranzas@cliente.example', 'token-de-fantasia')
    `
    await sql`
      INSERT INTO alegra_contacts (tenant_id, alegra_id, name, seller_name, payment_term_name,
                                   payment_term_days, credit_limit, raw)
      VALUES ('tenant-cc', '901', 'Cliente de Fantasía SA', 'Vendedor Uno', '30 días', 30, 150000,
              '{"phonePrimary":"000"}'::jsonb)
    `
    await sql`
      INSERT INTO client_commercial_conditions (tenant_id, codigocliente, condicion_pago)
      VALUES ('tenant-cc', '901', '30 días')
    `
    await sql`
      INSERT INTO notification_log (tenant_id, codigocliente, factura_id, type, channel, status)
      VALUES ('tenant-cc', '901', 'A-0001', 'before_due_3', 'email', 'sent')
    `
    await sql`
      INSERT INTO payment_receipts (tenant_id, codigocliente, razonsocial, amount, paid_on, method,
                                    declared_content_type, declared_size)
      VALUES ('tenant-cc', '901', 'Cliente de Fantasía SA', 1000, '2026-09-01', 'transferencia',
              'application/pdf', 1234)
    `
  })

  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM payment_receipts WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM notification_log WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM client_commercial_conditions WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM alegra_contacts WHERE tenant_id = 'tenant-cc'`
    await sql`DELETE FROM tenants WHERE id = 'tenant-cc'`
    if (rolCreadoAca) {
      // DROP OWNED revoca lo concedido en ESTA base (el rol recién creado no tiene nada en otras).
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  describe("vista alegra_contacts_shop", () => {
    it("lee las 4 columnas nuevas", async () => {
      expect(
        await comoShopApp(
          "SELECT seller_name, payment_term_name, payment_term_days, credit_limit FROM public.alegra_contacts_shop WHERE tenant_id = 'tenant-cc'",
        ),
      ).toEqual({ ok: true, filas: 1 })
    })

    it("la tabla alegra_contacts sigue cerrada", async () => {
      expect(await comoShopApp("SELECT raw FROM public.alegra_contacts")).toEqual(SIN_PERMISO)
    })
  })

  describe("tenants: sólo id, name, whatsapp_number, receipts_email", () => {
    it("lee las columnas concedidas", async () => {
      expect(
        await comoShopApp("SELECT id, name, whatsapp_number, receipts_email FROM public.tenants WHERE id = 'tenant-cc'"),
      ).toEqual({ ok: true, filas: 1 })
    })

    it.each(["SELECT * FROM public.tenants", "SELECT alegra_token FROM public.tenants", "SELECT ai_api_key FROM public.tenants"])(
      "%s → sin permiso",
      async (stmt) => {
        expect(await comoShopApp(stmt)).toEqual(SIN_PERMISO)
      },
    )

    it("no escribe", async () => {
      expect(await comoShopApp("UPDATE public.tenants SET name = 'x'")).toEqual(SIN_PERMISO)
    })
  })

  describe("client_commercial_conditions: sólo lectura", () => {
    it("lee", async () => {
      expect(await comoShopApp("SELECT * FROM public.client_commercial_conditions WHERE tenant_id = 'tenant-cc'")).toEqual({ ok: true, filas: 1 })
    })

    it("no escribe ni borra", async () => {
      expect(await comoShopApp("UPDATE public.client_commercial_conditions SET plazo_dias = 0")).toEqual(SIN_PERMISO)
      expect(await comoShopApp("DELETE FROM public.client_commercial_conditions")).toEqual(SIN_PERMISO)
    })
  })

  describe("notification_log: lee y sólo marca read_at", () => {
    it("marca leído", async () => {
      expect(
        await comoShopApp("UPDATE public.notification_log SET read_at = now() WHERE tenant_id = 'tenant-cc'"),
      ).toEqual({ ok: true, filas: 1 })
    })

    it("no toca otra columna, no inserta ni borra", async () => {
      expect(await comoShopApp("UPDATE public.notification_log SET status = 'x'")).toEqual(SIN_PERMISO)
      expect(
        await comoShopApp(
          "INSERT INTO public.notification_log (tenant_id, codigocliente, factura_id, type, channel, status) VALUES ('tenant-cc','901','A-0002','before_due_3','email','sent')",
        ),
      ).toEqual(SIN_PERMISO)
      expect(await comoShopApp("DELETE FROM public.notification_log")).toEqual(SIN_PERMISO)
    })
  })

  describe("payment_receipts: lee, inserta y actualiza sólo el flujo de informar pago", () => {
    it("inserta un comprobante uploading", async () => {
      expect(
        await comoShopApp(
          "INSERT INTO public.payment_receipts (tenant_id, codigocliente, razonsocial, amount, paid_on, method, declared_content_type, declared_size) VALUES ('tenant-cc','901','Cliente de Fantasía SA',500,'2026-09-02','cheque','image/jpeg',99)",
        ),
      ).toEqual({ ok: true, filas: 1 })
    })

    it("actualiza las columnas del claim, publish, reject y mail (con RETURNING)", async () => {
      expect(
        await comoShopApp(`
          UPDATE public.payment_receipts SET
            status = 'pending', processing_started_at = NULL, reject_reason = NULL,
            file_key = 'k', file_mime = 'application/pdf', file_size = 1, file_sha256 = 'x',
            converted_from = NULL, email_status = 'sent', email_error = NULL, email_sent_at = now(),
            email_attempts = email_attempts + 1, email_last_attempt_at = now(),
            submitted_at = now(), updated_at = now()
          WHERE tenant_id = 'tenant-cc' AND codigocliente = '901'
          RETURNING id, email_attempts
        `),
      ).toEqual({ ok: true, filas: 1 })
    })

    it.each([
      "loaded_at = now()",
      "loaded_by_name = 'x'",
      "alegra_payment_id = 1",
      "declared_amount = 1",
      "amount = 1",
      "codigocliente = '999'",
      "tenant_id = 'otro'",
    ])("UPDATE %s → sin permiso", async (set) => {
      expect(await comoShopApp(`UPDATE public.payment_receipts SET ${set}`)).toEqual(SIN_PERMISO)
    })

    it("no borra", async () => {
      expect(await comoShopApp("DELETE FROM public.payment_receipts")).toEqual(SIN_PERMISO)
    })
  })

  it("el bloque de GRANTs es idempotente (se puede correr a mano otra vez)", async () => {
    await expect(sql.unsafe(bloqueDeGrants())).resolves.toBeDefined()
  })
})
