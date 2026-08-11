CREATE TABLE "billing_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
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
ALTER TABLE "orders" ADD COLUMN "facturacion_tipo_doc" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "facturacion_nro_doc" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "facturacion_razon_social" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "facturacion_condicion_iva" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "facturacion_domicilio" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "requiere_revision" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bp_user" ON "billing_profiles" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "bp_doc" ON "billing_profiles" USING btree ("nro_doc");