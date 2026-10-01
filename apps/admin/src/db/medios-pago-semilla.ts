import { sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

// Fila fija de Mercado Pago en los medios de pago del checkout (change `medios-pago-desde-admin`).
// Misma forma que la migración 0057: inactiva, con cobro online, al final del orden actual.
// Idempotente: ON CONFLICT DO NOTHING no pisa una fila que ya exista (ni la edición del admin).
export async function sembrarMedioMercadoPago(
  db: Pick<PgDatabase<PgQueryResultHKT>, "execute">,
  tenantId: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO "medios_pago_shop" ("tenant_id", "slug", "nombre", "activo", "aplica_retiro", "aplica_envio", "cobro_online", "orden")
    VALUES (
      ${tenantId}, 'mercadopago', 'Mercado Pago', false, true, true, true,
      COALESCE((SELECT max(m."orden") + 1 FROM "medios_pago_shop" m WHERE m."tenant_id" = ${tenantId}), 0)
    )
    ON CONFLICT ("tenant_id", "slug") DO NOTHING
  `)
}
