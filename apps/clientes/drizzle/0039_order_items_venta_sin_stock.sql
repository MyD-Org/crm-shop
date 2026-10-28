-- Snapshot de la modalidad de venta sin stock en la línea del pedido (feature "venta sin stock por
-- modalidad"). ADITIVA: una columna jsonb nullable; NULL = línea normal (todas las filas existentes).
--
-- Esta migración tiene que correr ANTES de desplegar el código (db:migrate no corre en el deploy):
-- sin ella, `crearPedido` y el detalle del pedido del CRM fallan.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."order_items" DROP COLUMN "venta_sin_stock";

ALTER TABLE "shop"."order_items" ADD COLUMN "venta_sin_stock" jsonb;