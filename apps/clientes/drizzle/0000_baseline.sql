-- Baseline del esquema `shop` (squash de las 13 migraciones previas del Shop).
--
-- GENERADA con `npm run db:generate -- --name baseline` y después EDITADA A MANO.
-- Ediciones a mano: (a) y (b) — ver src/db/baseline.test.ts, que falla si una
-- regeneración las pierde. El snapshot (meta/0000_snapshot.json) NO se toca: lo
-- editado acá son objetos que schema.ts no puede modelar.
--
-- (a) `CREATE SCHEMA IF NOT EXISTS`: drizzle-kit lo emite sin `IF NOT EXISTS`,
--     pero el migrador ya creó el esquema para su tabla de control
--     (`shop.__drizzle_migrations`) antes de aplicar nada. Sin esto la baseline
--     falla con "schema shop already exists".
CREATE SCHEMA IF NOT EXISTS "shop";
--> statement-breakpoint
-- (b) Búsqueda insensible a tildes.
--
-- El shop es en español y el catálogo tiene texto acentuado ("Termomagnético",
-- "CÓNICO"). Con ILIKE pelado, buscar "termomagnetico" no encuentra nada.
-- La extensión vive en `public` (es de la base, compartida con el CRM) y se
-- referencia calificada: nada depende del search_path de la conexión.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
-- `unaccent()` no es IMMUTABLE (depende del diccionario), así que Postgres no la
-- acepta en un índice de expresión. Este wrapper fija el diccionario y sí es
-- indexable, por si más adelante hace falta. Hoy, con ~2800 filas, el seq scan
-- sobra: no se crea el índice todavía. Vive en `shop` y se llama siempre
-- calificada (`"shop".immutable_unaccent`, ver src/lib/catalog.ts).
CREATE OR REPLACE FUNCTION "shop".immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
--> statement-breakpoint
CREATE TABLE "shop"."billing_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"pais" text DEFAULT 'AR' NOT NULL,
	"tipo_doc" text NOT NULL,
	"nro_doc" text NOT NULL,
	"razon_social" text NOT NULL,
	"condicion_iva" text NOT NULL,
	"domicilio_calle" text,
	"domicilio_ciudad" text,
	"domicilio_provincia" text,
	"domicilio_cp" text,
	"coincide_con_alegra" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."catalog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alegra_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_alegra_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."catalog_overlay" (
	"alegra_id" text PRIMARY KEY NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"nombre" text,
	"descripcion" text,
	"categoria_id" uuid,
	"orden" integer,
	"tag_ids" uuid[] DEFAULT '{}' NOT NULL,
	"fotos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alegra_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"category_alegra_id" text,
	"brand" text,
	"prices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock" numeric,
	"iva_porcentaje" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."catalog_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"items_synced" integer DEFAULT 0 NOT NULL,
	"categories_synced" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shop"."catalogo_sync_state" (
	"tenant" text PRIMARY KEY NOT NULL,
	"cursor_updated_at" text,
	"cursor_alegra_id" text,
	"taxonomia_fetched_at" timestamp with time zone,
	"overlay_fetched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "shop"."client_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"alegra_contact_id" text NOT NULL,
	"razon_social" text,
	"cuit" text,
	"id_price_list" text,
	"tipo_cuenta" text,
	"estado" text DEFAULT 'activa' NOT NULL,
	"metodo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shop"."home_content" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."link_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"alegra_contact_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"destino_masked" text NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"alegra_item_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"brand" text,
	"qty" numeric(14, 3) NOT NULL,
	"precio_unitario" numeric(14, 2) NOT NULL,
	"iva_porcentaje" numeric(5, 2) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer GENERATED ALWAYS AS IDENTITY (sequence name "shop"."orders_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1000 CACHE 1),
	"tenant_id" text NOT NULL,
	"clerk_user_id" text,
	"cliente_codigo" text,
	"cliente_razon_social" text,
	"cliente_cuit" text,
	"cliente_email" text,
	"id_price_list" text,
	"contacto_nombre" text NOT NULL,
	"contacto_telefono" text NOT NULL,
	"entrega_tipo" text NOT NULL,
	"entrega_ciudad" text,
	"entrega_direccion" text,
	"facturacion_tipo_doc" text,
	"facturacion_nro_doc" text,
	"facturacion_razon_social" text,
	"facturacion_condicion_iva" text,
	"facturacion_domicilio" text,
	"requiere_revision" boolean DEFAULT false NOT NULL,
	"pago_metodo" text NOT NULL,
	"pago_estado" text DEFAULT 'pendiente' NOT NULL,
	"pago_proveedor" text,
	"pago_referencia" text,
	"pago_medio" text,
	"pago_detalle" text,
	"pago_actualizado_en" timestamp with time zone,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"cancelacion_motivo" text,
	"estado_actualizado_en" timestamp with time zone,
	"estado_actualizado_por" uuid,
	"estado_actualizado_por_nombre" text,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"costo_envio" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"notas" text,
	"idempotency_key" text,
	"cuotas_max" integer,
	"cuotas_plan" jsonb,
	"pago_cuotas" integer,
	"pago_total_pagado" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_estado_check" CHECK ("shop"."orders"."estado" in ('pendiente','confirmado','preparacion','en_camino','entregado','cancelado')),
	CONSTRAINT "orders_cancelacion_motivo_check" CHECK ("shop"."orders"."estado" <> 'cancelado' or "shop"."orders"."cancelacion_motivo" is not null)
);
--> statement-breakpoint
CREATE TABLE "shop"."payment_config_cache" (
	"tenant" text PRIMARY KEY NOT NULL,
	"payload" jsonb,
	"version" text,
	"fetched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "shop"."payment_plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proveedor" text NOT NULL,
	"medio" text NOT NULL,
	"planes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "shop"."shop_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"nombre" text NOT NULL,
	"slug" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"nivel" smallint DEFAULT 1 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"imagen" text
);
--> statement-breakpoint
CREATE TABLE "shop"."shop_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "shop"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bp_user" ON "shop"."billing_profiles" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "bp_doc" ON "shop"."billing_profiles" USING btree ("nro_doc");--> statement-breakpoint
CREATE UNIQUE INDEX "cc_alegra_id" ON "shop"."catalog_categories" USING btree ("alegra_id");--> statement-breakpoint
CREATE INDEX "cc_status_name" ON "shop"."catalog_categories" USING btree ("status","name");--> statement-breakpoint
CREATE INDEX "catalog_overlay_visible_idx" ON "shop"."catalog_overlay" USING btree ("visible");--> statement-breakpoint
CREATE INDEX "catalog_overlay_categoria_idx" ON "shop"."catalog_overlay" USING btree ("categoria_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cp_alegra_id" ON "shop"."catalog_products" USING btree ("alegra_id");--> statement-breakpoint
CREATE INDEX "cp_code" ON "shop"."catalog_products" USING btree ("code");--> statement-breakpoint
CREATE INDEX "cp_category" ON "shop"."catalog_products" USING btree ("category_alegra_id");--> statement-breakpoint
CREATE INDEX "cp_status_name" ON "shop"."catalog_products" USING btree ("status","name");--> statement-breakpoint
CREATE INDEX "csl_started" ON "shop"."catalog_sync_log" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cl_user_activa" ON "shop"."client_links" USING btree ("clerk_user_id") WHERE "shop"."client_links"."estado" = 'activa';--> statement-breakpoint
CREATE INDEX "cl_contacto" ON "shop"."client_links" USING btree ("alegra_contact_id");--> statement-breakpoint
CREATE INDEX "lo_user" ON "shop"."link_otps" USING btree ("clerk_user_id","created_at");--> statement-breakpoint
CREATE INDEX "lo_expira" ON "shop"."link_otps" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "order_items_order" ON "shop"."order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_numero" ON "shop"."orders" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency" ON "shop"."orders" USING btree ("idempotency_key") WHERE "shop"."orders"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_pago_referencia" ON "shop"."orders" USING btree ("pago_referencia") WHERE "shop"."orders"."pago_referencia" is not null;--> statement-breakpoint
CREATE INDEX "orders_cliente_fecha" ON "shop"."orders" USING btree ("cliente_codigo","created_at");--> statement-breakpoint
CREATE INDEX "orders_clerk_fecha" ON "shop"."orders" USING btree ("clerk_user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_estado" ON "shop"."orders" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "orders_tenant_fecha" ON "shop"."orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pps_proveedor_medio" ON "shop"."payment_plan_snapshots" USING btree ("proveedor","medio");--> statement-breakpoint
CREATE INDEX "shop_categories_parent_idx" ON "shop"."shop_categories" USING btree ("parent_id","orden");--> statement-breakpoint
CREATE INDEX "shop_categories_slug_idx" ON "shop"."shop_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "shop_tags_slug_idx" ON "shop"."shop_tags" USING btree ("slug");