-- Reserva de stock de los pedidos del Shop, change `webhooks-stock-alegra` (PR-3a).
--
-- Unidades apartadas por ítem y tenant, CALCULADAS AL LEER desde los pedidos: no hay tabla de
-- reservas que dar de alta ni de baja, y el stock del espejo (el de Alegra) nunca se toca. El
-- Shop muestra y valida `disponible = max(0, stock − qty)` (src/lib/stock-disponible.ts).
--
-- Reserva un pedido NO facturado (`facturado_en IS NULL`, lo marca el CRM) que está:
--   - `confirmado`, `preparacion` o `en_camino`: hasta que se entrega, se cancela o se factura;
--   - `pendiente` (a coordinar): 24 h desde su creación. Es la misma ventana que
--     `VENTANA_PAGO_MS` de src/lib/pedidos.ts (src/db/stock-reservado.test.ts las ata); vencida,
--     la reserva cae sola. Un pendiente ya PAGADO online no vence: se cobró y no puede perder
--     las unidades por la demora del operador en confirmarlo.
-- No reservan: `cancelado`, `entregado`, facturados, pendientes vencidos sin pagar.
--
-- Drift que vive SOLO en SQL: la vista está en src/db/schema.ts como `.existing()` (drizzle-kit
-- no la genera ni la compara); el snapshot 0012 es igual al 0011. Si cambia o se borra alguna de
-- las columnas que usa (orders: id, tenant_id, estado, created_at, pago_estado, facturado_en;
-- order_items: order_id, alegra_item_id, qty), recrear la vista en la MISMA migración
-- (DROP VIEW + CREATE VIEW + GRANT).
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que la lee), en una migración
-- nueva, append-only; nunca editar ésta:
--   DROP VIEW "shop"."stock_reservado";
CREATE VIEW "shop"."stock_reservado" AS
SELECT o.tenant_id,
       oi.alegra_item_id,
       sum(oi.qty) AS qty
FROM "shop"."orders" o
JOIN "shop"."order_items" oi ON oi.order_id = o.id
WHERE o.facturado_en IS NULL
  AND (o.estado IN ('confirmado', 'preparacion', 'en_camino')
       OR (o.estado = 'pendiente'
           AND (o.created_at > now() - interval '24 hours' OR o.pago_estado = 'pagado')))
GROUP BY o.tenant_id, oi.alegra_item_id;
--> statement-breakpoint
-- Los DEFAULT PRIVILEGES del esquema `shop` ya le dan SELECT a `shop_app` si la vista la crea el
-- rol dueño (el de MIGRATE_DATABASE_URL). El GRANT explícito es cinturón por si la creó otro
-- rol. Condicional: la base de test del CRM (crm_test) y las ramas sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ON "shop"."stock_reservado" TO shop_app;
  END IF;
END $$;
