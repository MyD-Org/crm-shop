-- Envío por zona con tarifa (change `envio-por-zona-con-tarifa`, rebanada A): método "Envío en el día".
--
-- Orden de aplicación: ESTA migración (CRM 0101) va PRIMERO, antes de la 0045 del Shop y antes de
-- desplegar código que la lea. `db:migrate` NO corre en el deploy: aplicarla a mano en staging y en
-- prod y verificarla con un SELECT a `metodos_envio`.
--
-- El operador dibuja polígonos en un mapa del CRM (una geometría por zona, GeoJSON MultiPolygon
-- [lon, lat] guardado como jsonb, sin PostGIS) y le pone a cada zona un precio FINAL con IVA incluido.
-- Respaldo opcional por localidad Georef o CP (`metodos_envio_zona_entradas`). `metodos_envio_localidades`
-- guarda las localidades que atiende (abreviaturas, centro y rectángulo) para el autocompletado y para
-- estimar el precio antes de tener la dirección.
--
-- Drift que vive SOLO en SQL: los CHECK de abajo y el GRANT (drizzle-kit no los conoce).
-- `NOT activo OR item_alegra_id IS NOT NULL`: un método sin ítem de Alegra no puede estar activo
-- (sin ítem la factura no cuadraría con el total del pedido).
--
-- Seguridad: `shop_app` sólo LEE (SELECT). No hay secretos en estas tablas; el Shop copia el ítem de
-- Alegra y el horario al pedido (snapshot) y no vuelve a leer el método para facturar.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que las usa):
--   DROP TABLE metodos_envio_zona_entradas; DROP TABLE metodos_envio_localidades;
--   DROP TABLE metodos_envio_zonas; DROP TABLE metodos_envio;
CREATE TABLE "metodos_envio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text DEFAULT 'tarifa_zona' NOT NULL,
	"activo" boolean DEFAULT false NOT NULL,
	"orden" smallint DEFAULT 0 NOT NULL,
	"provincia_clave" text NOT NULL,
	"sucursal_origen" text,
	"dias_operativos" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
	"hora_corte" time DEFAULT '09:00' NOT NULL,
	"margen_min" smallint DEFAULT 0 NOT NULL,
	"promesa" text DEFAULT '' NOT NULL,
	"aviso_feriados" text DEFAULT '' NOT NULL,
	"gratis_aplica" boolean DEFAULT false NOT NULL,
	"item_alegra_id" text,
	"item_alegra_iva" numeric(5, 2) DEFAULT '21' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metodos_envio_localidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metodo_id" uuid NOT NULL,
	"georef_id" text NOT NULL,
	"etiqueta" text NOT NULL,
	"nombre_norm" text NOT NULL,
	"abreviaturas" text[] DEFAULT '{}'::text[] NOT NULL,
	"centro_lat" numeric(9, 6),
	"centro_lon" numeric(9, 6),
	"bbox_sur" numeric(9, 6),
	"bbox_oeste" numeric(9, 6),
	"bbox_norte" numeric(9, 6),
	"bbox_este" numeric(9, 6)
);
--> statement-breakpoint
CREATE TABLE "metodos_envio_zona_entradas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zona_id" uuid NOT NULL,
	"metodo_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"valor" text NOT NULL,
	"etiqueta" text NOT NULL,
	"nombre_norm" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metodos_envio_zonas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metodo_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"precio" numeric(12, 2) NOT NULL,
	"orden" smallint DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"geometria" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
-- Antes de las FK: la compuesta de las entradas apunta a este índice único.
CREATE UNIQUE INDEX "metodos_envio_zonas_id_metodo_uniq" ON "metodos_envio_zonas" USING btree ("id","metodo_id");
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metodos_envio_localidades" ADD CONSTRAINT "metodos_envio_localidades_metodo_id_metodos_envio_id_fk" FOREIGN KEY ("metodo_id") REFERENCES "public"."metodos_envio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metodos_envio_zona_entradas" ADD CONSTRAINT "metodos_envio_zona_entradas_zona_fk" FOREIGN KEY ("zona_id","metodo_id") REFERENCES "public"."metodos_envio_zonas"("id","metodo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metodos_envio_zonas" ADD CONSTRAINT "metodos_envio_zonas_metodo_id_metodos_envio_id_fk" FOREIGN KEY ("metodo_id") REFERENCES "public"."metodos_envio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metodos_envio_tenant_slug_uniq" ON "metodos_envio" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "metodos_envio_tenant_activo_idx" ON "metodos_envio" USING btree ("tenant_id","activo");--> statement-breakpoint
CREATE UNIQUE INDEX "metodos_envio_localidades_metodo_georef_uniq" ON "metodos_envio_localidades" USING btree ("metodo_id","georef_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metodos_envio_zona_entradas_metodo_tipo_valor_uniq" ON "metodos_envio_zona_entradas" USING btree ("metodo_id","tipo","valor");--> statement-breakpoint
CREATE UNIQUE INDEX "metodos_envio_zonas_metodo_nombre_uniq" ON "metodos_envio_zonas" USING btree ("metodo_id","nombre");
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_tipo_chk" CHECK ("tipo" IN ('tarifa_zona'));
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_margen_chk" CHECK ("margen_min" BETWEEN 0 AND 240);
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_dias_chk" CHECK (cardinality("dias_operativos") > 0 AND "dias_operativos" <@ '{1,2,3,4,5}'::smallint[]);
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_slug_chk" CHECK ("slug" ~ '^[a-z0-9-]{1,40}$');
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_iva_chk" CHECK ("item_alegra_iva" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "metodos_envio" ADD CONSTRAINT "metodos_envio_activo_item_chk" CHECK (NOT "activo" OR "item_alegra_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "metodos_envio_zonas" ADD CONSTRAINT "metodos_envio_zonas_precio_chk" CHECK ("precio" > 0);
--> statement-breakpoint
ALTER TABLE "metodos_envio_zonas" ADD CONSTRAINT "metodos_envio_zonas_geometria_chk" CHECK (jsonb_typeof("geometria") = 'array');
--> statement-breakpoint
ALTER TABLE "metodos_envio_zona_entradas" ADD CONSTRAINT "metodos_envio_zona_entradas_valor_chk" CHECK (("tipo" = 'georef' AND "valor" ~ '^[0-9]{1,12}$') OR ("tipo" = 'cp' AND "valor" ~ '^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$'));
--> statement-breakpoint
ALTER TABLE "metodos_envio_localidades" ADD CONSTRAINT "metodos_envio_localidades_georef_chk" CHECK ("georef_id" ~ '^[0-9]{1,12}$');
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."metodos_envio", "public"."metodos_envio_zonas", "public"."metodos_envio_zona_entradas", "public"."metodos_envio_localidades" TO shop_app;
  END IF;
END $$;
