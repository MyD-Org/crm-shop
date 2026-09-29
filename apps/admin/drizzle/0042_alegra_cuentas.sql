-- Cuentas de Alegra por sucursal + stock por sucursal + catálogo unión (change
-- `sucursales-igz-mdp`, rebanada D, lote 1: modelo de datos). Solo ESTRUCTURA; cero datos reales.
-- Credenciales, CUIT y asignaciones se cargan por el admin (Configuración > Sucursales y ventas).
--
-- - `alegra_cuentas`: unidad contable (credenciales, CUIT). Una fila `principal` por tenant,
--   creada acá SIN credenciales propias: reutiliza las de `tenants` (no se duplica el token).
-- - `sucursales.cuenta_alegra_id`: cuenta que factura / sincroniza cada sucursal. FK compuesta
--   (tenant_id, cuenta_alegra_id) para que una sucursal no apunte a una cuenta de otro tenant.
-- - `catalog_stock_sucursal`: producto x sucursal -> stock (+ `item_id_cuenta`, id del ítem en la
--   cuenta de esa sucursal). Se borra en cascada con la sucursal (es dato derivado del sync).
-- - `catalog_products`: `cuenta_id` (NULL = principal: todas las filas de hoy), `alegra_id_cuenta`
--   (NULL = igual a `alegra_id`) y `reemplazado_por_alegra_id`. Nullable, sin backfill. La clave
--   `(tenant_id, alegra_id)` NO cambia. La vista `catalog_products_shop` NO se toca: no expone
--   las columnas nuevas y el Shop no necesita saber la cuenta de origen.
-- - `catalog_sync_log.cuenta_id`: NULL = la principal.
--
-- GRANT a `shop_app` (condicional, patrón 0035/0038/0041):
--   - `catalog_stock_sucursal`: SELECT por COLUMNA (tenant_id, sucursal, alegra_id, stock,
--     leido_at); queda afuera `item_id_cuenta`.
--   - `alegra_cuentas`: NADA (guarda credenciales). `sucursales.cuenta_alegra_id`: no concedida
--     (el GRANT de 0041 es por columna y no la incluye).
-- Si el rol se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0035/0037/0038/0041): el CHECK del slug de la
-- cuenta, el CHECK de `origen`, el índice único parcial de `principal` y los GRANTs no están en
-- src/db/schema.ts (el schema sí conoce las tablas y columnas).
--
-- Orden: los índices únicos van ANTES de las FK compuestas que los usan (Postgres exige un UNIQUE
-- completo en la tabla referenciada); drizzle-kit emite la FK primero.
--
-- Reversa (en una migración nueva; nunca editar ésta). Sin cuentas secundarias activas todo vuelve
-- a lo de hoy; si hubo filas solo-secundaria, desactivarlas (`cuenta_id IS NOT NULL`) antes de
-- revertir el código:
--   ALTER TABLE "catalog_sync_log" DROP COLUMN "cuenta_id";
--   ALTER TABLE "catalog_products" DROP COLUMN "cuenta_id", DROP COLUMN "alegra_id_cuenta",
--     DROP COLUMN "reemplazado_por_alegra_id";
--   DROP TABLE "catalog_stock_sucursal";
--   ALTER TABLE "sucursales" DROP COLUMN "cuenta_alegra_id";
--   DROP TABLE "alegra_cuentas";

CREATE TABLE "alegra_cuentas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"nombre" text NOT NULL,
	"cuit" text DEFAULT '' NOT NULL,
	"alegra_email" text DEFAULT '' NOT NULL,
	"alegra_token" text DEFAULT '' NOT NULL,
	"alegra_mock" boolean DEFAULT false NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alegra_cuentas_tenant_slug_uniq" ON "alegra_cuentas" USING btree ("tenant_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "alegra_cuentas_tenant_id_uniq" ON "alegra_cuentas" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "alegra_cuentas_principal_uniq" ON "alegra_cuentas" USING btree ("tenant_id") WHERE "alegra_cuentas"."principal";
--> statement-breakpoint
ALTER TABLE "alegra_cuentas" ADD CONSTRAINT "alegra_cuentas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "alegra_cuentas" ADD CONSTRAINT "alegra_cuentas_slug_formato" CHECK ("slug" ~ '^[a-z0-9-]{2,12}$');
--> statement-breakpoint
INSERT INTO "alegra_cuentas" ("tenant_id", "slug", "nombre", "principal")
SELECT "id", 'principal', "name", true FROM "tenants"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "sucursales" ADD COLUMN "cuenta_alegra_id" uuid;
--> statement-breakpoint
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_cuenta_alegra_fk" FOREIGN KEY ("tenant_id","cuenta_alegra_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "catalog_stock_sucursal" (
	"tenant_id" text NOT NULL,
	"sucursal" text NOT NULL,
	"alegra_id" text NOT NULL,
	"item_id_cuenta" text,
	"stock" numeric DEFAULT '0' NOT NULL,
	"origen" text NOT NULL,
	"leido_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "css_pk" PRIMARY KEY("tenant_id","sucursal","alegra_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "css_sucursal_item_uniq" ON "catalog_stock_sucursal" USING btree ("tenant_id","sucursal","item_id_cuenta") WHERE "catalog_stock_sucursal"."item_id_cuenta" is not null;
--> statement-breakpoint
ALTER TABLE "catalog_stock_sucursal" ADD CONSTRAINT "catalog_stock_sucursal_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "catalog_stock_sucursal" ADD CONSTRAINT "css_sucursal_fk" FOREIGN KEY ("tenant_id","sucursal") REFERENCES "public"."sucursales"("tenant_id","slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "catalog_stock_sucursal" ADD CONSTRAINT "css_origen_valido" CHECK ("origen" in ('sync', 'webhook', 'factura', 'manual'));
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "cuenta_id" uuid;
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "alegra_id_cuenta" text;
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "reemplazado_por_alegra_id" text;
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_cuenta_id_alegra_cuentas_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."alegra_cuentas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "cp_tenant_cuenta" ON "catalog_products" USING btree ("tenant_id","cuenta_id");
--> statement-breakpoint
ALTER TABLE "catalog_sync_log" ADD COLUMN "cuenta_id" uuid;
--> statement-breakpoint
ALTER TABLE "catalog_sync_log" ADD CONSTRAINT "catalog_sync_log_cuenta_id_alegra_cuentas_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."alegra_cuentas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("tenant_id", "sucursal", "alegra_id", "stock", "leido_at") ON "public"."catalog_stock_sucursal" TO shop_app;
  END IF;
END $$;
