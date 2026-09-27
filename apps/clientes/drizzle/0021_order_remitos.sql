-- Remito único por pedido, change `admin-emitir-factura-pedido` (rebanada D).
--
-- Tabla aparte (no columnas en `orders`, a diferencia de `factura_*`): la restricción de
-- unicidad de `order_id` hace que un segundo intento de remitar el mismo pedido choque contra
-- Postgres (23505) en vez de necesitar el mecanismo de reserva atómica con sentinel que sí usa
-- "Emitir factura" (rebanada C). No hace falta acá: confirmado contra la ayuda de Alegra
-- Argentina que la remisión/remito "no genera movimientos de inventario... es simplemente un
-- documento informativo" (sólo la factura descuenta stock), así que una carrera entre dos
-- POST simultáneos deja como mucho un remito huérfano sin vincular en Alegra, sin ningún efecto
-- de stock o dinero.
--
-- Sin desglose por línea a propósito (decisión de la usuaria): el remito es siempre íntegro,
-- nunca una entrega parcial.
CREATE TABLE "shop"."order_remitos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"remito_alegra_id" text NOT NULL,
	"remito_numero" text,
	"remito_fecha" date,
	"remitido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"remitido_por" text,
	"remitido_por_nombre" text
);
--> statement-breakpoint
ALTER TABLE "shop"."order_eventos" DROP CONSTRAINT "order_eventos_tipo_check";--> statement-breakpoint
ALTER TABLE "shop"."order_remitos" ADD CONSTRAINT "order_remitos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "shop"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_remitos_order_id" ON "shop"."order_remitos" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_remitos_tenant_order" ON "shop"."order_remitos" USING btree ("tenant_id","order_id");--> statement-breakpoint
ALTER TABLE "shop"."order_eventos" ADD CONSTRAINT "order_eventos_tipo_check" CHECK ("shop"."order_eventos"."tipo" in ('estado','pago','factura_vinculada','factura_desvinculada','factura_emitida','cancelado','remito_emitido','remito_vinculado','remito_desvinculado'));