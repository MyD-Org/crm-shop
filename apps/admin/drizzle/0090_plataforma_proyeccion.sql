-- Proyección del catálogo de la plataforma en el CRM (spec platform 2026-10-13 §2 "Proyecciones",
-- Plan B). La plataforma entrega por webhook cada cambio de las specs proyectadas al CRM
-- (`atributos_tecnicos`) y el documento de esas specs; el CRM guarda una copia de sólo lectura.
--
-- REGLA BLOQUEANTE: estas tablas las escribe SOLAMENTE el receptor de eventos
-- (src/app/api/platform/events + lib/plataforma-proyeccion-repo.ts). Ningún otro código del CRM
-- ni del Shop las toca: si alguien escribe acá directo hay dos fuentes de verdad.
--
-- `catalog_atributos_shop` desarma el jsonb en las MISMAS cinco columnas que `catalog_atributos`
-- (0049), para que el Shop pueda leer la proyección sin cambiar sus consultas; el corte (0091)
-- convierte `catalog_atributos` en una vista con este mismo SELECT. `fuentes` no es un atributo.
--
-- El cursor de productos es compuesto (productos_cursor, productos_cursor_clave): catalog_products.synced_at
-- lleva UN mismo valor por lote de sync, así que un cursor sólo por fecha saltearía para siempre
-- las filas empatadas; el desempate es el alegra_id.
--
-- GRANT a shop_app (condicional como 0049/0078): SELECT por columna sobre la vista y sobre
-- catalog_specs (slug, version, document: etiquetas y unidades para dibujar claves nuevas).
-- Nada sobre catalog_proyeccion, plataforma_entregas ni plataforma_sync_estado.
--
-- Drift que vive SOLO en SQL: la vista y los GRANT no están en src/db/schema.ts.
--
-- Reversa (en una migración NUEVA, nunca editar ésta):
--   DROP VIEW "catalog_atributos_shop"; DROP TABLE "plataforma_sync_estado";
--   DROP TABLE "plataforma_entregas"; DROP TABLE "catalog_specs"; DROP TABLE "catalog_proyeccion";
CREATE TABLE "catalog_proyeccion" (
	"tenant_id" text NOT NULL REFERENCES "tenants"("id"),
	"spec" text NOT NULL,
	"external_key" text NOT NULL,
	"instance_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"recibido_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "catalog_proyeccion_pk" PRIMARY KEY ("tenant_id", "spec", "external_key")
);
--> statement-breakpoint
CREATE TABLE "catalog_specs" (
	"tenant_id" text NOT NULL REFERENCES "tenants"("id"),
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"recibido_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "catalog_specs_pk" PRIMARY KEY ("tenant_id", "slug")
);
--> statement-breakpoint
CREATE TABLE "plataforma_entregas" (
	"tenant_id" text NOT NULL REFERENCES "tenants"("id"),
	"delivery_id" text NOT NULL,
	"event_id" text NOT NULL,
	"action" text NOT NULL,
	"recibido_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "plataforma_entregas_pk" PRIMARY KEY ("tenant_id", "delivery_id")
);
--> statement-breakpoint
CREATE TABLE "plataforma_sync_estado" (
	"tenant_id" text PRIMARY KEY REFERENCES "tenants"("id"),
	"productos_cursor" timestamp with time zone NOT NULL DEFAULT 'epoch',
	"productos_cursor_clave" text NOT NULL DEFAULT '',
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE VIEW "catalog_atributos_shop" AS
SELECT p."tenant_id", p."external_key" AS "alegra_id", a."key" AS "clave",
       (a."value"->>'n')::numeric AS "valor_num", a."value"->>'t' AS "valor_texto"
FROM "catalog_proyeccion" p, jsonb_each(p."data") a
WHERE p."spec" = 'atributos_tecnicos' AND a."key" <> 'fuentes'
  AND ((a."value"->>'n') IS NOT NULL OR (a."value"->>'t') IS NOT NULL);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("tenant_id", "alegra_id", "clave", "valor_num", "valor_texto") ON "public"."catalog_atributos_shop" TO shop_app;
    GRANT SELECT ("tenant_id", "slug", "version", "document") ON "public"."catalog_specs" TO shop_app;
  END IF;
END $$;
