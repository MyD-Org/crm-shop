-- El Shop lee los precios online y las condiciones de los medios de pago (change
-- `listas-precio-online`, rebanada C).
--
-- Qué cambia:
--  1. `lista_precio_condiciones`: qué lista de precio online rige para un medio de pago (y, desde la
--     rebanada D, para una cantidad de cuotas). Una condición apunta a UNA lista; la lista no se
--     puede borrar mientras alguna condición la use (FK RESTRICT). `cuotas` NULL = pago único.
--  2. La vista `catalog_products_shop` conserva sus 12 columnas y su orden, pero la columna de
--     precios deja de salir de los precios de Alegra: ahora emite `precios_online`. El NOMBRE de la
--     columna sigue siendo `precios_alegra` (nombre histórico): renombrarla rompería al Shop que
--     está en producción y cambiaría el contrato de la vista. El shape es el mismo
--     [{idPriceList, name, price, main}], donde idPriceList es el uuid de la lista online y `main`
--     marca la de referencia. Los precios de Alegra dejan de salir de la base hacia el Shop.
--  3. Se eliminan `medios_pago_shop.id_lista_precios` y `lista_precios_nombre` (enlace con las
--     listas de Alegra, ahora reemplazado por las condiciones). Los medios arrancan sin enlace: rige
--     la lista de referencia hasta que se los enlace desde el admin.
--  4. El historial de cambios admite el tipo 'condicion'.
--
-- GRANT a `shop_app` (condicional, patrón 0035/0037), ÚLTIMO statement: SELECT de la vista (se
-- re-concede, idempotente) y SELECT de `lista_precio_condiciones`. NINGÚN grant sobre costos,
-- listas, overrides, config, historial ni retenciones: el Shop no ve cómo se calcula el precio.
-- Si el rol se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner.
--
-- Aplicar en prod ANTES de desplegar el código: el código nuevo del Shop lee las condiciones y el
-- viejo lee `id_lista_precios` (que esta migración borra).
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK de `cuotas`, el índice único
-- con coalesce(cuotas, 0), la vista y los GRANTs.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   CREATE OR REPLACE VIEW public.catalog_products_shop AS  -- el SELECT de 0037, con precios_alegra
--   ALTER TABLE "medios_pago_shop" ADD COLUMN "id_lista_precios" text, ADD COLUMN "lista_precios_nombre" text;
--   ALTER TABLE "precios_online_cambios" DROP CONSTRAINT "precios_online_cambios_tipo_chk",
--     ADD CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN (...los de 0064...));
--   DROP TABLE "lista_precio_condiciones";

CREATE TABLE "lista_precio_condiciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"lista_id" uuid NOT NULL,
	"medio_slug" text NOT NULL,
	"cuotas" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lista_precio_condiciones_cuotas_chk" CHECK ("cuotas" IS NULL OR "cuotas" >= 2)
);
--> statement-breakpoint
ALTER TABLE "lista_precio_condiciones" ADD CONSTRAINT "lista_precio_condiciones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lista_precio_condiciones" ADD CONSTRAINT "lista_precio_condiciones_lista_id_listas_precio_online_id_fk" FOREIGN KEY ("lista_id") REFERENCES "public"."listas_precio_online"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lista_precio_condiciones" ADD CONSTRAINT "lista_precio_condiciones_medio_fk" FOREIGN KEY ("tenant_id","medio_slug") REFERENCES "public"."medios_pago_shop"("tenant_id","slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "lista_precio_condiciones_uniq" ON "lista_precio_condiciones" USING btree ("tenant_id","medio_slug",coalesce("cuotas", 0));
--> statement-breakpoint
CREATE INDEX "lista_precio_condiciones_lista_idx" ON "lista_precio_condiciones" USING btree ("lista_id");
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" DROP CONSTRAINT "precios_online_cambios_tipo_chk";
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" ADD CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN ('lista_alta','lista_edicion','lista_baja','referencia','override_alta','override_edicion','override_baja','umbral','condicion','revertir','costo_aprobado','costo_rechazado'));
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" DROP COLUMN "id_lista_precios";
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" DROP COLUMN "lista_precios_nombre";
--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."catalog_products_shop" AS
SELECT tenant_id,
       alegra_id,
       stock,
       precios_online AS precios_alegra,
       (status = 'active' AND coalesce(alegra_status, 'active') <> 'inactive') AS activo,
       alegra_leido_at,
       name,
       description,
       code,
       brand,
       category_alegra_id,
       iva_porcentaje
FROM "public"."catalog_products";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop" TO shop_app;
    GRANT SELECT ON "public"."lista_precio_condiciones" TO shop_app;
  END IF;
END $$;
