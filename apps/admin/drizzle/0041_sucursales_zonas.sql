-- Sucursales y zonas (change `sucursales-igz-mdp`, rebanada A).
--
-- Solo ESTRUCTURA: cero datos. Direcciones, WhatsApp, horarios y filas de `zonas` se cargan por
-- el admin (Configuración > Sucursales y ventas) o a mano en la DB; el repo es público.
--
-- - `sucursales`: unidad comercial (zona, retiro). Slug estable por tenant, con CHECK de formato.
--   Una sola `predeterminada` y una sola `maestra` por tenant (índices únicos parciales).
-- - `zonas`: provincia -> sucursal, una fila por provincia. FK compuestas a `sucursales`.
--
-- GRANT a `shop_app` (el Shop las lee, no las escribe), condicional como 0035/0038:
--   - `sucursales`: SELECT por COLUMNA. Quedan afuera `id`, `deposito_alegra_id` y los timestamps
--     (y la futura `cuenta_alegra_id` de la rebanada D, que NO se concede).
--   - `zonas`: SELECT de la tabla (no tiene nada sensible).
-- Si el rol se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0035/0037/0038): el CHECK del slug y los GRANTs
-- no están en src/db/schema.ts. El snapshot 0041 solo suma las dos tablas.
--
-- Orden: los índices únicos van ANTES de las FK compuestas de `zonas` (Postgres exige un UNIQUE
-- completo en la tabla referenciada); drizzle-kit los emite al revés.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP TABLE "zonas"; DROP TABLE "sucursales";

CREATE TABLE "sucursales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"nombre" text NOT NULL,
	"direccion" text DEFAULT '' NOT NULL,
	"ciudad" text DEFAULT '' NOT NULL,
	"provincia" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"horario" text DEFAULT '' NOT NULL,
	"acepta_retiro" boolean DEFAULT true NOT NULL,
	"acepta_envio" boolean DEFAULT true NOT NULL,
	"envio_ciudades" text[] DEFAULT '{}'::text[] NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"predeterminada" boolean DEFAULT false NOT NULL,
	"maestra" boolean DEFAULT false NOT NULL,
	"deposito_alegra_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zonas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"provincia_clave" text NOT NULL,
	"provincia" text NOT NULL,
	"sucursal" text NOT NULL,
	"factura_sucursal" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sucursales_tenant_slug_uniq" ON "sucursales" USING btree ("tenant_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "sucursales_predeterminada_uniq" ON "sucursales" USING btree ("tenant_id") WHERE "sucursales"."predeterminada";
--> statement-breakpoint
CREATE UNIQUE INDEX "sucursales_maestra_uniq" ON "sucursales" USING btree ("tenant_id") WHERE "sucursales"."maestra";
--> statement-breakpoint
CREATE UNIQUE INDEX "zonas_tenant_provincia_uniq" ON "zonas" USING btree ("tenant_id","provincia_clave");
--> statement-breakpoint
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_sucursal_fk" FOREIGN KEY ("tenant_id","sucursal") REFERENCES "public"."sucursales"("tenant_id","slug") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_factura_sucursal_fk" FOREIGN KEY ("tenant_id","factura_sucursal") REFERENCES "public"."sucursales"("tenant_id","slug") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_slug_formato" CHECK ("slug" ~ '^[a-z0-9-]{2,20}$');
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT (
      "tenant_id", "slug", "nombre", "direccion", "ciudad", "provincia", "whatsapp", "horario",
      "acepta_retiro", "acepta_envio", "envio_ciudades", "orden", "activa", "predeterminada"
    ) ON "public"."sucursales" TO shop_app;
    GRANT SELECT ON "public"."zonas" TO shop_app;
  END IF;
END $$;
