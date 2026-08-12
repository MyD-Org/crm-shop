ALTER TABLE "orders" ADD COLUMN "pago_proveedor" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pago_referencia" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pago_medio" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pago_detalle" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pago_actualizado_en" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_pago_referencia" ON "orders" USING btree ("pago_referencia") WHERE "orders"."pago_referencia" is not null;