-- Cuenta de Alegra que factura cada pedido (change `sucursales-igz-mdp`, rebanada D, lote 3).
-- Solo ESTRUCTURA; cero datos. Tabla del CRM (esquema `public`): el Shop no la lee ni la escribe.
--
-- Por qué una tabla del CRM y no columnas en `shop.orders`: `shop.orders` es del Shop; pedirle una
-- columna cruzaría el contrato entre apps. `order_id` apunta a `shop.orders.id` sin FK (otro
-- esquema). Si la rebanada B necesita `factura_cruzada` en la vista de reserva, decide entre
-- (a) un GRANT por columna sobre esta tabla o (b) una columna del Shop escrita por el CRM.
--
-- - `cuenta_override_id`: la cuenta que el operador eligió en el pedido (NULL = la calculada).
--   `override_por`, `override_por_nombre`, `override_en`, `override_anterior_id`: auditoría (el
--   historial del pedido no admite tipos de evento nuevos: CHECK `order_eventos_tipo_check`).
-- - `factura_cuenta_id` / `factura_cruzada`: cuenta con la que se emitió la factura y si difiere de
--   la sucursal que despacha. Se limpian al desvincular la factura.
--
-- Drift que vive SOLO en SQL: ninguno (sin CHECK ni GRANT).
--
-- Reversa (en una migración nueva; nunca editar ésta): DROP TABLE "pedido_factura_cuenta";
-- el pedido vuelve a facturarse con la cuenta calculada.

CREATE TABLE "pedido_factura_cuenta" (
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"cuenta_override_id" uuid,
	"override_por" text,
	"override_por_nombre" text,
	"override_en" timestamp with time zone,
	"override_anterior_id" uuid,
	"factura_cuenta_id" uuid,
	"factura_cruzada" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pfc_pk" PRIMARY KEY("tenant_id","order_id")
);
--> statement-breakpoint
ALTER TABLE "pedido_factura_cuenta" ADD CONSTRAINT "pedido_factura_cuenta_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pedido_factura_cuenta" ADD CONSTRAINT "pfc_override_fk" FOREIGN KEY ("tenant_id","cuenta_override_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pedido_factura_cuenta" ADD CONSTRAINT "pfc_anterior_fk" FOREIGN KEY ("tenant_id","override_anterior_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pedido_factura_cuenta" ADD CONSTRAINT "pfc_factura_fk" FOREIGN KEY ("tenant_id","factura_cuenta_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE no action ON UPDATE no action;
