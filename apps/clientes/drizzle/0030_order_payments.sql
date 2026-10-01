-- Pagos registrados a mano en un pedido offline, change `pago-transferencia-comprobante`
-- (rebanada D).
--
-- ADITIVA: tabla nueva; nada existente cambia. "Registrar pago" del CRM guarda acá monto, fecha,
-- referencia y el comprobante opcional (`receipt_id` = `public.payment_receipts.id`, SIN FK: es
-- del esquema `public`, dueño el CRM). Anular es baja lógica (`anulado_en`): la fila queda.
--
-- Sólo el CRM la escribe y la lee, conectado con el rol dueño (como `order_eventos`, 0020): sin
-- GRANT a `shop_app`, que no la usa. Si algún día el Shop la lee (p. ej. Mi cuenta), esa
-- migración concede SELECT por columna.
--
-- El CRM la escribe en cada "Registrar pago": esta migración tiene que correr ANTES de
-- desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   DROP TABLE "shop"."order_payments";
CREATE TABLE "shop"."order_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"referencia" text,
	"receipt_id" uuid,
	"registrado_por" uuid,
	"registrado_por_nombre" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anulado_en" timestamp with time zone,
	"anulado_por" uuid,
	"anulado_por_nombre" text,
	CONSTRAINT "order_payments_amount_check" CHECK ("shop"."order_payments"."amount" > 0),
	CONSTRAINT "order_payments_referencia_check" CHECK ("shop"."order_payments"."referencia" is null or char_length("shop"."order_payments"."referencia") <= 100)
);
--> statement-breakpoint
ALTER TABLE "shop"."order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "shop"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_payments_tenant_order" ON "shop"."order_payments" USING btree ("tenant_id","order_id");