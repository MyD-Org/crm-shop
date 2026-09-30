-- Reserva por sucursal (change `sucursales-igz-mdp`, rebanada B, lote 1). ADITIVA: columnas nuevas
-- (nullable o con default), un backfill acotado y una vista NUEVA. Nada existente cambia: la vista
-- `shop.stock_reservado` (0012) NO se toca y sigue siendo la que leen `stock-disponible.ts` y el
-- CRM hasta que el lote 2 migre los lectores, detrás del flag `disponibilidad-sucursal`.
--
-- Columnas (los mismos nombres que espeja el CRM):
--   orders.factura_cruzada     boolean NOT NULL DEFAULT false. El pedido se factura por una cuenta
--                              distinta de la que despacha: la reserva sigue en la sucursal que
--                              despacha hasta entregar o cancelar.
--   orders.reserva_vence_en    timestamptz NULL. Snapshot de `crearPedido`: hasta cuándo reserva un
--                              pendiente sin pago. NULL = sin vencimiento; `infinity` = "nunca".
--   orders.contactado_en / contactado_por (uuid) / contactado_por_nombre: seguimiento de contacto
--                              (lo escribe el CRM; NULL = sin contactar).
--   order_items.a_traer_de     text NULL. Slug de la sucursal de la que se trae la línea cuando no
--                              sale de la que despacha (línea "a traer"). SIN FK (mismo criterio
--                              que `orders.sucursal`: `shop_app` no tiene REFERENCES sobre `public`).
--
-- Backfill: los pendientes EXISTENTES sin pago conservan su regla vieja (24 h): reserva_vence_en =
-- created_at + 24 h. Sin esto, con `reserva_vence_en IS NULL` (= no vence) volverían a reservar
-- para siempre los pendientes ya vencidos. El vencimiento nuevo (reserva_dias) sólo rige para los
-- pedidos que cree el código nuevo.
--
-- Vista `shop.stock_reservado_sucursal`: unidades reservadas por (tenant, sucursal, ítem).
--   - sucursal = coalesce(order_items.a_traer_de, orders.sucursal): una línea "a traer" reserva en
--     la sucursal de la que sale, el resto en la que despacha.
--   - PEDIDOS CON `orders.sucursal` NULL NO ENTRAN (anteriores a las sucursales o creados con el
--     flag `sucursales` apagado): no hay a qué sucursal imputarlos. Siguen reservando en la vista
--     0012 mientras el flag `disponibilidad-sucursal` esté apagado; al prenderlo, los que sigan
--     vivos dejan de descontar (revisar cuántos hay antes: la 0023 backfilleó `sucursal` con la
--     maestra cuando existía).
--   - Reserva un pedido en estado pendiente / confirmado / preparacion / en_camino (los finales,
--     entregado y cancelado, no) que NO esté facturado, o que esté facturado por otra cuenta
--     (`factura_cruzada`: sigue reservando hasta entregar o cancelar).
--   - Un pendiente reserva mientras esté pagado, o `reserva_vence_en` sea NULL o futuro.
--
-- Drift que vive SOLO en SQL: la vista está en src/db/schema.ts como `.existing()` (drizzle-kit no
-- la genera ni la compara). Si cambia o se borra alguna columna que usa (orders: id, tenant_id,
-- estado, pago_estado, sucursal, facturado_en, factura_cruzada, reserva_vence_en; order_items:
-- order_id, alegra_item_id, qty, a_traer_de), recrear la vista en la MISMA migración
-- (DROP VIEW + CREATE VIEW + GRANT). El backfill y el GRANT también viven sólo acá.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta): apagar el flag
-- `disponibilidad-sucursal` (la 0012 sigue intacta); recién con el código nuevo revertido:
--   DROP VIEW "shop"."stock_reservado_sucursal";
-- Las columnas quedan inertes; no hace falta borrarlas.
ALTER TABLE "shop"."order_items" ADD COLUMN "a_traer_de" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "factura_cruzada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "reserva_vence_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "contactado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "contactado_por" uuid;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "contactado_por_nombre" text;--> statement-breakpoint
UPDATE "shop"."orders"
SET "reserva_vence_en" = "created_at" + interval '24 hours'
WHERE "estado" = 'pendiente' AND "pago_estado" <> 'pagado' AND "reserva_vence_en" IS NULL;--> statement-breakpoint
CREATE VIEW "shop"."stock_reservado_sucursal" AS
SELECT o.tenant_id,
       coalesce(oi.a_traer_de, o.sucursal) AS sucursal,
       oi.alegra_item_id,
       sum(oi.qty) AS qty
FROM "shop"."orders" o
JOIN "shop"."order_items" oi ON oi.order_id = o.id
WHERE o.estado IN ('pendiente', 'confirmado', 'preparacion', 'en_camino')
  AND (o.facturado_en IS NULL OR o.factura_cruzada)
  AND (o.estado <> 'pendiente'
       OR o.pago_estado = 'pagado'
       OR o.reserva_vence_en IS NULL
       OR o.reserva_vence_en > now())
  AND coalesce(oi.a_traer_de, o.sucursal) IS NOT NULL
GROUP BY o.tenant_id, coalesce(oi.a_traer_de, o.sucursal), oi.alegra_item_id;
--> statement-breakpoint
-- Los DEFAULT PRIVILEGES del esquema `shop` ya le dan SELECT a `shop_app` si la vista la crea el
-- rol dueño. El GRANT explícito es cinturón. Condicional: crm_test y las ramas sin el rol no lo
-- tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ON "shop"."stock_reservado_sucursal" TO shop_app;
  END IF;
END $$;
