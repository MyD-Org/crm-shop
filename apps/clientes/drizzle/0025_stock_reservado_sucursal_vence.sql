-- Semántica de `orders.reserva_vence_en` en la vista `shop.stock_reservado_sucursal` (change
-- `sucursales-igz-mdp`, rebanada B; corrige el hallazgo C1 de la verificación). Recrea la vista de
-- la 0024 (DROP VIEW + CREATE VIEW + GRANT en esta misma migración); NO toca la vista 0012.
--
-- Problema: la 0024 leía `reserva_vence_en IS NULL` como "no vence", pero el CRM (y el design D8) lo
-- leen como "24 h desde created_at", y el Shop dejaba NULL con `reserva_dias = 0` y con pedidos
-- creados sin contexto de disponibilidad: esos pendientes reservaban para siempre.
--
-- Semántica nueva (design D8):
--   - un pendiente sin pago reserva mientras
--       coalesce(reserva_vence_en, created_at + interval '24 hours') > now()
--     (NULL = pedido anterior o sin snapshot: la ventana de 24 h de siempre);
--   - "nunca vence" se guarda como 'infinity'::timestamptz (`infinity` > now() es verdadero);
--   - el resto del filtro (estados vivos, facturado / factura_cruzada, sucursal NOT NULL,
--     agrupación) es idéntico a la 0024.
--
-- Datos existentes: los pendientes con NULL pasan de "reservan siempre" a "reservan 24 h desde su
-- creación" (la 0024 ya había fijado created_at + 24 h a los pendientes sin pago que existían al
-- migrar). No hace falta backfill; la vista sólo se lee con el flag `disponibilidad-sucursal`.
--
-- Drift que vive SOLO en SQL: la vista está en src/db/schema.ts como `.existing()`; si cambia o se
-- borra alguna columna que usa (orders: id, tenant_id, estado, pago_estado, sucursal, facturado_en,
-- factura_cruzada, reserva_vence_en, created_at; order_items: order_id, alegra_item_id, qty,
-- a_traer_de), recrear la vista en la MISMA migración (DROP VIEW + CREATE VIEW + GRANT).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta): recrear la vista tal
-- cual está en la 0024_orders_reserva_sucursal.sql (DROP VIEW "shop"."stock_reservado_sucursal" y
-- volver a ejecutar su CREATE VIEW + GRANT). Con la vista de la 0024, `infinity` sigue siendo
-- "no vence" pero un NULL vuelve a significar "no vence".
DROP VIEW "shop"."stock_reservado_sucursal";--> statement-breakpoint
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
       OR coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now())
  AND coalesce(oi.a_traer_de, o.sucursal) IS NOT NULL
GROUP BY o.tenant_id, coalesce(oi.a_traer_de, o.sucursal), oi.alegra_item_id;
--> statement-breakpoint
-- Cinturón: los DEFAULT PRIVILEGES del esquema `shop` ya le dan SELECT a `shop_app`. Condicional:
-- crm_test y las ramas sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ON "shop"."stock_reservado_sucursal" TO shop_app;
  END IF;
END $$;
