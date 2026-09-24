CREATE TABLE "alegra_documento_items" (
	"tenant_id" text NOT NULL,
	"tipo" text NOT NULL,
	"alegra_doc_id" text NOT NULL,
	"item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"estado" text,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adi_pk" PRIMARY KEY("tenant_id","tipo","alegra_doc_id")
);
--> statement-breakpoint
CREATE TABLE "alegra_item_refresh" (
	"tenant_id" text NOT NULL,
	"alegra_id" text NOT NULL,
	"pedido_at" timestamp with time zone DEFAULT now() NOT NULL,
	"motivo" text NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"tomado_hasta" timestamp with time zone,
	"ultimo_error" text,
	CONSTRAINT "air_pk" PRIMARY KEY("tenant_id","alegra_id")
);
--> statement-breakpoint
CREATE TABLE "alegra_stock_drenaje" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"ocupado_hasta" timestamp with time zone,
	"ultimo_drenaje_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alegra_webhook_avisos" (
	"tenant_id" text NOT NULL,
	"dia" date NOT NULL,
	"evento" text NOT NULL,
	"cantidad" integer DEFAULT 0 NOT NULL,
	"ultimo_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "awa_pk" PRIMARY KEY("tenant_id","dia","evento")
);
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "alegra_leido_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "leido_por" text;--> statement-breakpoint
ALTER TABLE "alegra_documento_items" ADD CONSTRAINT "alegra_documento_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alegra_item_refresh" ADD CONSTRAINT "alegra_item_refresh_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alegra_stock_drenaje" ADD CONSTRAINT "alegra_stock_drenaje_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alegra_webhook_avisos" ADD CONSTRAINT "alegra_webhook_avisos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "air_tenant_pedido" ON "alegra_item_refresh" USING btree ("tenant_id","pedido_at");