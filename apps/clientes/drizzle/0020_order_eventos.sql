-- Historial de eventos de un pedido, change `admin-pedidos-datos` (rediseño de Pedidos del CRM).
--
-- Hasta acá `shop.orders` sólo guardaba el ÚLTIMO cambio de estado, el último pago manual y la
-- factura vinculada ACTUAL: no había forma de reconstruir la secuencia completa de un pedido.
-- Esta tabla agrega una fila por evento, sin tocar ni reemplazar esas columnas "resumen" (las
-- sigue escribiendo el CRM igual que antes; esto es ADEMÁS).
--
-- El evento "creado" NO se guarda acá a propósito: se deriva de `orders.created_at` al leer, así
-- se evita un contrato nuevo con el Shop (que sigue sin enterarse de esta tabla).
--
-- Sólo el CRM la escribe (rol dueño, conectado sin `search_path`): sin GRANT a `shop_app`, que
-- no la usa.
CREATE TABLE "shop"."order_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"detalle" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"actor_nombre" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_eventos_tipo_check" CHECK ("shop"."order_eventos"."tipo" in ('estado','pago','factura_vinculada','factura_desvinculada','factura_emitida','cancelado'))
);
--> statement-breakpoint
ALTER TABLE "shop"."order_eventos" ADD CONSTRAINT "order_eventos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "shop"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_eventos_tenant_order_fecha" ON "shop"."order_eventos" USING btree ("tenant_id","order_id","creado_en" DESC NULLS LAST);--> statement-breakpoint

-- ─────────────────────────────── Backfill ───────────────────────────────
--
-- Reconstruye lo que se PUEDE reconstruir de las columnas resumen existentes. No es el
-- historial completo (esas columnas sólo guardaban el último valor, nunca los intermedios):
--   - 'estado': un solo evento con el estado actual (`desde` queda null: se desconoce la
--     transición previa). Actor = quien hizo ese último cambio.
--   - 'cancelado': sólo si el pedido terminó cancelado, con el motivo que ya tenía la fila.
--     Mismo actor y fecha que el evento 'estado' de arriba (fue el mismo cambio).
--   - 'pago': sólo si hay un `pago_actualizado_en`. `actor_id`/`actor_nombre` quedan null en los
--     pagos ONLINE (el webhook del proveedor no pasa por un operador); sólo los manuales (0017)
--     tienen `pago_registrado_por`.
--   - 'factura_vinculada': sólo si el pedido tiene una factura vinculada AHORA. Una factura
--     vinculada y luego desvinculada no deja rastro en `orders` (las siete columnas se
--     vaciaron), así que no hay forma de reconstruirla acá; queda como hueco conocido.
--
-- No se backfillea 'factura_desvinculada' ni 'factura_emitida' por lo mismo: ninguna columna de
-- `orders` guarda ese evento.

INSERT INTO "shop"."order_eventos" (tenant_id, order_id, tipo, detalle, actor_id, actor_nombre, creado_en)
SELECT tenant_id, id, 'estado', jsonb_build_object('desde', null, 'hacia', estado),
       estado_actualizado_por::text, estado_actualizado_por_nombre, estado_actualizado_en
FROM "shop"."orders"
WHERE estado_actualizado_en IS NOT NULL;
--> statement-breakpoint

INSERT INTO "shop"."order_eventos" (tenant_id, order_id, tipo, detalle, actor_id, actor_nombre, creado_en)
SELECT tenant_id, id, 'cancelado', jsonb_build_object('motivo', cancelacion_motivo),
       estado_actualizado_por::text, estado_actualizado_por_nombre,
       coalesce(estado_actualizado_en, created_at)
FROM "shop"."orders"
WHERE estado = 'cancelado' AND cancelacion_motivo IS NOT NULL;
--> statement-breakpoint

INSERT INTO "shop"."order_eventos" (tenant_id, order_id, tipo, detalle, actor_id, actor_nombre, creado_en)
SELECT tenant_id, id, 'pago', jsonb_build_object('estado', pago_estado),
       pago_registrado_por::text, pago_registrado_por_nombre, pago_actualizado_en
FROM "shop"."orders"
WHERE pago_actualizado_en IS NOT NULL;
--> statement-breakpoint

INSERT INTO "shop"."order_eventos" (tenant_id, order_id, tipo, detalle, actor_id, actor_nombre, creado_en)
SELECT tenant_id, id, 'factura_vinculada', jsonb_build_object('numero', factura_numero),
       facturado_por::text, facturado_por_nombre, facturado_en
FROM "shop"."orders"
WHERE factura_alegra_id IS NOT NULL AND facturado_en IS NOT NULL;
