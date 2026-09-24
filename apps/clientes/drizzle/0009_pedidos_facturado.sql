ALTER TABLE "shop"."orders" ADD COLUMN "facturado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "facturado_por" uuid;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "facturado_por_nombre" text;--> statement-breakpoint
CREATE INDEX "orders_reserva_activa" ON "shop"."orders" USING btree ("tenant_id","created_at") WHERE "shop"."orders"."facturado_en" is null and "shop"."orders"."estado" in ('pendiente','confirmado','preparacion','en_camino');