import { sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

type Db = Pick<PgDatabase<PgQueryResultHKT>, "execute">

// Filas fijas de cobro en línea en los medios de pago del checkout. Misma forma que las migraciones
// 0057 (Mercado Pago) y 0067 (Payway): inactivas, con cobro online, al final del orden actual.
// Idempotentes: ON CONFLICT DO NOTHING no pisa una fila que ya exista (ni la edición del admin).
async function sembrarMedioDeCobro(db: Db, tenantId: string, slug: string, nombre: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO "medios_pago_shop" ("tenant_id", "slug", "nombre", "activo", "aplica_retiro", "aplica_envio", "cobro_online", "orden")
    VALUES (
      ${tenantId}, ${slug}, ${nombre}, false, true, true, true,
      COALESCE((SELECT max(m."orden") + 1 FROM "medios_pago_shop" m WHERE m."tenant_id" = ${tenantId}), 0)
    )
    ON CONFLICT ("tenant_id", "slug") DO NOTHING
  `)
}

// Change `medios-pago-desde-admin`.
export async function sembrarMedioMercadoPago(db: Db, tenantId: string): Promise<void> {
  await sembrarMedioDeCobro(db, tenantId, "mercadopago", "Mercado Pago")
}

// Change `payway-cobro`, rebanada B.
export async function sembrarMedioPayway(db: Db, tenantId: string): Promise<void> {
  await sembrarMedioDeCobro(db, tenantId, "payway", "Tarjeta de crédito o débito - Payway")
}
