-- URL del Shop de cada empresa (change `shop-para-avantec`, rebanada 2: URL y secreto del ping por tenant).
--
-- `shop_url`: URL pública de la tienda del tenant (la que se enlaza en mails, portal y agente).
-- `shop_internal_url`: base a la que el CRM manda el ping de revalidación del Shop de ese tenant
-- (puede ser la misma). '' = el tenant no tiene Shop propio configurado: rige el par histórico
-- de envs (NEXT_PUBLIC_SHOP_URL / SHOP_INTERNAL_URL), ver src/lib/shop-destino.ts.
--
-- El SECRETO del ping NO se guarda acá: vive en la env del admin `SHOP_CRM_SECRET_<SLUG>`.
-- Sin GRANT: el Shop no lee estas columnas, así que tampoco entran a crm-contrato.json.
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del CRM que las lee):
--   ALTER TABLE public.tenants DROP COLUMN shop_internal_url, DROP COLUMN shop_url;
ALTER TABLE "tenants" ADD COLUMN "shop_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "shop_internal_url" text DEFAULT '' NOT NULL;
