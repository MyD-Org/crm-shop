-- Una sola regla de reserva para `shop.stock_reservado`, con o sin el flag `disponibilidad-sucursal`
-- (change `reserva-una-sola-regla`). Recrea la vista de la 0012 (DROP VIEW + CREATE VIEW + GRANT en
-- esta misma migración); NO toca `stock_reservado_sucursal` (0025).
--
-- Problema: la 0012 vencía todo pendiente sin pago a las 24 h fijas desde `created_at` e ignoraba
-- `orders.reserva_vence_en`, mientras que con el flag prendido la 0025 respeta los `reserva_dias` de
-- las reglas de venta del CRM. Dos reglas según un flag.
--
-- Semántica nueva (la misma de la 0025): un pendiente sin pago reserva mientras
--     coalesce(reserva_vence_en, created_at + interval '24 hours') > now()
-- (NULL = pedido anterior o sin snapshot: las 24 h de siempre; 'infinity' = nunca vence; Mercado Pago
-- guarda created_at + 24 h). `crearPedido` ahora guarda `reserva_vence_en` siempre. Estados vivos
-- iguales a la 0025 (pendiente, confirmado, preparacion, en_camino); facturado igual que la 0012
-- (`facturado_en IS NULL`, sin factura cruzada, porque esta vista no es por sucursal).
--
-- Datos existentes: sin backfill. Los pendientes con `reserva_vence_en` NULL siguen venciendo a las
-- 24 h desde su creación (idéntico a hoy); los que tienen valor (los creados con sucursal) pasan a
-- vencer según ese valor, que con el flag apagado antes se ignoraba, así que algunos reservan más
-- tiempo que antes (hasta `reserva_dias`).
--
-- Drift que vive SOLO en SQL: la vista está en src/db/schema.ts como `.existing()`; si cambia o se
-- borra alguna columna que usa (orders: tenant_id, estado, pago_estado, facturado_en,
-- reserva_vence_en, created_at; order_items: order_id, alegra_item_id, qty), recrear la vista en la
-- MISMA migración (DROP VIEW + CREATE VIEW + GRANT).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta): recrear la vista tal
-- cual está en la 0012_stock_reservado.sql (DROP VIEW "shop"."stock_reservado" y volver a ejecutar
-- su CREATE VIEW + GRANT).
DROP VIEW "shop"."stock_reservado";--> statement-breakpoint
CREATE VIEW "shop"."stock_reservado" AS
SELECT o.tenant_id,
       oi.alegra_item_id,
       sum(oi.qty) AS qty
FROM "shop"."orders" o
JOIN "shop"."order_items" oi ON oi.order_id = o.id
WHERE o.facturado_en IS NULL
  AND o.estado IN ('pendiente', 'confirmado', 'preparacion', 'en_camino')
  AND (o.estado <> 'pendiente'
       OR o.pago_estado = 'pagado'
       OR coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now())
GROUP BY o.tenant_id, oi.alegra_item_id;
--> statement-breakpoint
-- Cinturón: los DEFAULT PRIVILEGES del esquema `shop` ya le dan SELECT a `shop_app`. Condicional:
-- crm_test y las ramas sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ON "shop"."stock_reservado" TO shop_app;
  END IF;
END $$;
