CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"alegra_item_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"brand" text,
	"qty" numeric(14, 3) NOT NULL,
	"precio_unitario" numeric(14, 2) NOT NULL,
	"iva_porcentaje" numeric(5, 2) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1000 CACHE 1),
	"cliente_codigo" text NOT NULL,
	"cliente_razon_social" text,
	"cliente_cuit" text,
	"cliente_email" text,
	"id_price_list" text,
	"contacto_nombre" text NOT NULL,
	"contacto_telefono" text NOT NULL,
	"entrega_tipo" text NOT NULL,
	"entrega_ciudad" text,
	"entrega_direccion" text,
	"pago_metodo" text NOT NULL,
	"pago_estado" text DEFAULT 'pendiente' NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"costo_envio" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_numero" ON "orders" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "orders_cliente_fecha" ON "orders" USING btree ("cliente_codigo","created_at");--> statement-breakpoint
CREATE INDEX "orders_estado" ON "orders" USING btree ("estado");