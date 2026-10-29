-- Campañas de precios en el pedido (spec apps/admin/docs/superpowers/specs/2026-10-28-campanias-precios-design.md).
-- ADITIVA: tres columnas nullable en `shop.order_items`, sólo para trazabilidad y para contar unidades.
--   - campania_id / campania_regla_id: la campaña y la regla con las que se cotizó la línea (ids de
--     `public.campanias` / `public.campania_reglas` del CRM, migración 0095). Sin FK: es otro esquema y
--     una campaña programada puede borrarse. El límite de unidades de una regla se cuenta por
--     `campania_regla_id`.
--   - precio_normal: el unitario normal SIN IVA que se tachó. NULL = línea sin campaña.
-- OJO al mergear con crm-shop#695 (venta sin stock), que también trae una Shop 0039 (`when`
-- 1793073164188, anterior al de ésta): el migrador de drizzle saltea en silencio una migración con
-- `when` menor que la última aplicada y el journal del Shop no admite huecos (src/db/baseline.test.ts).
-- Si esta rama llega primero, la de #695 pasa a 0040 con un `when` mayor que 1793228720756; si #695
-- llega primero, ésta pasa a 0040 (su `when` ya es posterior). Ver también la 0095 del CRM.
--
-- Correr DESPUÉS de la 0095 del CRM y ANTES de desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."order_items" DROP COLUMN "precio_normal";
--   ALTER TABLE "shop"."order_items" DROP COLUMN "campania_regla_id";
--   ALTER TABLE "shop"."order_items" DROP COLUMN "campania_id";
ALTER TABLE "shop"."order_items" ADD COLUMN "campania_id" uuid;--> statement-breakpoint
ALTER TABLE "shop"."order_items" ADD COLUMN "campania_regla_id" uuid;--> statement-breakpoint
ALTER TABLE "shop"."order_items" ADD COLUMN "precio_normal" numeric(14, 2);