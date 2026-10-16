-- CORTE (Plan B, rollout paso 6): los atributos técnicos pasan a vivir en la plataforma. La tabla
-- `catalog_atributos` se conserva como `catalog_atributos_legacy` (sin grants, para auditoría y
-- rollback) y en su lugar se crea una VISTA `catalog_atributos` con las MISMAS cinco columnas que
-- el Shop lee (contrato crm-shop-base/v1 §6), sobre `catalog_atributos_shop` (0090). El Shop no
-- cambia ninguna consulta.
--
-- La PK (`catalog_atributos_pk`), los CHECK (`catalog_atributos_clave_check`, `_fuente_check`,
-- `_valor_check`) y los índices viajan con el rename y conservan su nombre. La FK a `tenants` se
-- renombra a `catalog_atributos_legacy_tenant_id_tenants_id_fk`, el nombre que deriva drizzle de
-- la tabla nueva (así el snapshot 0091 coincide con la base).
--
-- PRERREQUISITOS (no se aplica sin esto): el tenant en modo `dual` desde antes, el backfill corrido
-- y `plataforma:paridad-atributos` en cero. Al aplicarla, el tenant pasa a `plataforma_atributos = 'on'`
-- (los escritores dejan de tocar la tabla vieja y los lectores del admin leen la proyección).
-- OJO: la vista es global, no por tenant: un tenant que siga en `off`/`dual` sigue escribiendo
-- `catalog_atributos_legacy`, pero el Shop pasa a leer la proyección de la plataforma.
--
-- Drift que vive SOLO en SQL: la vista y los GRANT/REVOKE no están en src/db/schema.ts.
--
-- Reversa (en una migración NUEVA, nunca editar ésta; antes volver el tenant a 'dual'):
--   DROP VIEW "catalog_atributos";
--   ALTER TABLE "catalog_atributos_legacy" RENAME CONSTRAINT "catalog_atributos_legacy_tenant_id_tenants_id_fk" TO "catalog_atributos_tenant_id_tenants_id_fk";
--   ALTER TABLE "catalog_atributos_legacy" RENAME TO "catalog_atributos";
--   (y re-correr el bloque DO $$ de GRANT de 0049 sobre la tabla; en schema.ts volver a
--   `catalogAtributos = pgTable("catalog_atributos", …)` y regenerar el snapshot)
ALTER TABLE "catalog_atributos" RENAME TO "catalog_atributos_legacy";
--> statement-breakpoint
ALTER TABLE "catalog_atributos_legacy" RENAME CONSTRAINT "catalog_atributos_tenant_id_tenants_id_fk" TO "catalog_atributos_legacy_tenant_id_tenants_id_fk";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    REVOKE ALL ON "public"."catalog_atributos_legacy" FROM shop_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE VIEW "catalog_atributos" AS
SELECT "tenant_id", "alegra_id", "clave", "valor_num", "valor_texto" FROM "catalog_atributos_shop";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("tenant_id", "alegra_id", "clave", "valor_num", "valor_texto") ON "public"."catalog_atributos" TO shop_app;
  END IF;
END $$;
