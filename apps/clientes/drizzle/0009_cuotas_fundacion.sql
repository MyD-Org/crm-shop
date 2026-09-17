CREATE TABLE "payment_config_cache" (
	"tenant" text PRIMARY KEY NOT NULL,
	"payload" jsonb,
	"version" text,
	"fetched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "payment_plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proveedor" text NOT NULL,
	"medio" text NOT NULL,
	"planes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cuotas_max" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cuotas_plan" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pago_cuotas" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pago_total_pagado" numeric(14, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "pps_proveedor_medio" ON "payment_plan_snapshots" USING btree ("proveedor","medio");