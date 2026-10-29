-- Campañas de precios en el pedido (spec apps/admin/docs/superpowers/specs/2026-10-28-campanias-precios-design.md).
-- ADITIVA: tres columnas nullable en `shop.order_items`, sólo para trazabilidad y para contar unidades.
--   - campania_id / campania_regla_id: la campaña y la regla con las que se cotizó la línea (ids de
--     `public.campanias` / `public.campania_reglas` del CRM, migración 0095). Sin FK: es otro esquema y
--     una campaña programada puede borrarse. El límite de unidades de una regla se cuenta por
--     `campania_regla_id`.
--   - precio_normal: el unitario normal SIN IVA que se tachó. NULL = línea sin campaña.
--
-- Va después de la 0039 (venta sin stock, crm-shop#695, ya en staging). Correr DESPUÉS de la 0095 del
-- CRM y ANTES de desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."order_items" DROP COLUMN "precio_normal";
--   ALTER TABLE "shop"."order_items" DROP COLUMN "campania_regla_id";
--   ALTER TABLE "shop"."order_items" DROP COLUMN "campania_id";
ALTER TABLE "shop"."order_items" ADD COLUMN "campania_id" uuid;--> statement-breakpoint
ALTER TABLE "shop"."order_items" ADD COLUMN "campania_regla_id" uuid;--> statement-breakpoint
ALTER TABLE "shop"."order_items" ADD COLUMN "precio_normal" numeric(14, 2);