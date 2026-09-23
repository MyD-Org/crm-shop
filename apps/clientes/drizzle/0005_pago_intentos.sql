CREATE TABLE "shop"."pago_intentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"proveedor" text NOT NULL,
	"referencia" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"detalle" text,
	"medio" text,
	"cuotas" integer,
	"total_pagado" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pago_intentos_estado_check" CHECK ("shop"."pago_intentos"."estado" in ('pendiente','pagado','fallido'))
);
--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD CONSTRAINT "pago_intentos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "shop"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pago_intentos_referencia" ON "shop"."pago_intentos" USING btree ("proveedor","referencia") WHERE "shop"."pago_intentos"."referencia" is not null;--> statement-breakpoint
CREATE INDEX "pago_intentos_order" ON "shop"."pago_intentos" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pago_intentos_tenant_estado" ON "shop"."pago_intentos" USING btree ("tenant_id","estado");--> statement-breakpoint
-- Backfill: un intento por cada pedido que ya tenía un cobro iniciado, así el
-- webhook y la reconciliación los siguen encontrando por la tabla nueva. Los
-- intentos anteriores que se pisaron en `orders.pago_referencia` no se pueden
-- recuperar desde la base; el webhook los rescata por `external_reference`.
INSERT INTO "shop"."pago_intentos"
	("tenant_id", "order_id", "proveedor", "referencia", "estado", "detalle", "medio", "cuotas", "total_pagado", "created_at", "updated_at")
SELECT
	"tenant_id", "id", "pago_proveedor", "pago_referencia", "pago_estado", "pago_detalle", "pago_medio", "pago_cuotas", "pago_total_pagado",
	coalesce("pago_actualizado_en", "created_at"), coalesce("pago_actualizado_en", "created_at")
FROM "shop"."orders"
WHERE "pago_referencia" IS NOT NULL AND "pago_proveedor" IS NOT NULL;
