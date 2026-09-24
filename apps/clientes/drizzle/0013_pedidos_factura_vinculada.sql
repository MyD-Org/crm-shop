ALTER TABLE "shop"."orders" ADD COLUMN "factura_alegra_id" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "factura_numero" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "factura_fecha" date;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "factura_total" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_factura_facturado_check" CHECK ("shop"."orders"."factura_alegra_id" is null or "shop"."orders"."facturado_en" is not null);