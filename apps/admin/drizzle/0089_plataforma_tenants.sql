-- Plataforma (spec platform 2026-10-13, Plan B): credenciales y modo por tenant para hablar con el
-- catálogo de la plataforma (ai-api). Mismo patrón que ai_api_url / ai_api_key: columnas en
-- `tenants`, con fallback de entorno `{PREFIX}_PLATAFORMA_*` en buildTenantConfig.
--
-- `plataforma_atributos` es el modo de escritura de atributos técnicos:
--   off  = como siempre, sólo catalog_atributos (default);
--   dual = catalog_atributos Y la plataforma (transición: backfill + paridad);
--   on   = sólo la plataforma (después del corte 0091).
--
-- Sin GRANT a shop_app: el Shop no lee estas columnas.
--
-- Reversa (en una migración NUEVA, nunca editar ésta):
--   ALTER TABLE "tenants" DROP CONSTRAINT "tenants_plataforma_atributos_check",
--     DROP COLUMN "plataforma_url", DROP COLUMN "plataforma_api_key",
--     DROP COLUMN "plataforma_webhook_secret", DROP COLUMN "plataforma_atributos";
ALTER TABLE "tenants" ADD COLUMN "plataforma_url" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plataforma_api_key" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plataforma_webhook_secret" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plataforma_atributos" text NOT NULL DEFAULT 'off';
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plataforma_atributos_check" CHECK ("plataforma_atributos" IN ('off', 'dual', 'on'));
