-- Cupones de descuento (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md).
-- ADITIVA:
--   - shop.cupon_canjes: una fila por pedido con cupón (order_id único, cascade con el pedido). SIN
--     estado: vivo / usado / liberado se calcula desde el pedido (src/lib/pedido-vivo.ts). codigo_id
--     y promocion_id son ids de public.cupon_codigos / cupon_promociones (CRM 0097), sin FK.
--   - orders.cupon: foto del cupón con el que se cotizó (para la línea del resumen y para recotizar).
--   - order_items.precio_sin_cupon: unitario sin IVA antes del cupón en las líneas alcanzadas.
--   - carts.cupon: código guardado en el carrito del servidor.
--
-- Va después de la 0040 (campañas). Correr DESPUÉS de la 0097 del CRM (vista cupones_shop) y ANTES de
-- desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   DROP TABLE "shop"."cupon_canjes";
--   ALTER TABLE "shop"."orders" DROP COLUMN "cupon";
--   ALTER TABLE "shop"."order_items" DROP COLUMN "precio_sin_cupon";
--   ALTER TABLE "shop"."carts" DROP COLUMN "cupon";
CREATE TABLE "shop"."cupon_canjes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"codigo_id" uuid NOT NULL,
	"promocion_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"clerk_user_id" text,
	"email" text,
	"descuento_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cupon_canjes_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "shop"."carts" ADD COLUMN "cupon" text;--> statement-breakpoint
ALTER TABLE "shop"."order_items" ADD COLUMN "precio_sin_cupon" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "cupon" jsonb;--> statement-breakpoint
ALTER TABLE "shop"."cupon_canjes" ADD CONSTRAINT "cupon_canjes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "shop"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cupon_canjes_tenant_codigo" ON "shop"."cupon_canjes" USING btree ("tenant_id","codigo_id");--> statement-breakpoint
CREATE INDEX "cupon_canjes_tenant_promocion" ON "shop"."cupon_canjes" USING btree ("tenant_id","promocion_id");
--> statement-breakpoint
-- Los DEFAULT PRIVILEGES del esquema `shop` ya le dan acceso a `shop_app` si la tabla la crea el rol
-- dueño. El GRANT explícito es cinturón (patrón 0026). DELETE: liberar el canje al cambiar a un
-- medio que no acepta el cupón. Condicional: las bases sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT, INSERT, DELETE ON "shop"."cupon_canjes" TO shop_app;
  END IF;
END $$;
