-- Shops ADICIONALES por tenant (change `dominios-clerk-por-host`): un tenant puede servir su tienda
-- desde más de un dominio (mismo código, otro proyecto de Vercel con su propia app de Clerk).
-- - `tenants.shop_destinos_extra jsonb NOT NULL DEFAULT '[]'`: lista de
--   `{ "etiqueta": "...", "url": "https://...", "urlInterna": "https://..." }` (urlInterna opcional,
--   máx. 4). El Shop PRINCIPAL sigue siendo `shop_url` / `shop_internal_url`. La forma se valida al
--   leer (`parsearDestinosExtra`, src/lib/shop-destino.ts): no se confía en la base. El secreto de
--   cada extra NO se guarda acá: env `SHOP_CRM_SECRET_<TENANT>__<ETIQUETA>` del admin.
-- - Las filas previas quedan en `[]`: el ping avisa solo al principal, igual que antes.
-- Sin GRANT a `shop_app`: el Shop no lee esta columna (no entra a crm-contrato.json).
--
-- Drift que vive SOLO en SQL (como 0050/0093): el CHECK no está en src/db/schema.ts.
--
-- Reversa (en una migración nueva, SOLO después de sacar del código la lectura; nunca editar ésta):
--   ALTER TABLE "tenants" DROP COLUMN "shop_destinos_extra";

ALTER TABLE "tenants" ADD COLUMN "shop_destinos_extra" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_shop_destinos_extra_array_chk" CHECK (jsonb_typeof("shop_destinos_extra") = 'array');
