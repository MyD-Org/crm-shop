-- Vista angosta del espejo de productos para el Shop (apps/clientes), change
-- `webhooks-stock-alegra` (rebanada 2).
--
-- El Shop lee de acá stock, precios y estado de cada ítem de Alegra que el CRM mantiene al día
-- (sync diaria + webhooks de stock, 0033). Lo lee con el rol `shop_app`, que tiene SELECT sobre
-- la vista y NADA sobre la tabla `catalog_products`.
--
-- Columnas acotadas a propósito: sin `raw` completo, sin nombres, descripciones ni imágenes.
--   precios_alegra = raw->'price' tal cual lo devuelve Alegra (el Shop lo mapea con su propio
--                    mapper, que calcula la lista principal; `prices` del CRM no la trae).
--   activo         = visto en la última sync (status) y no inactivo en Alegra (alegra_status).
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034): la vista y el GRANT no están en
-- src/db/schema.ts; drizzle-kit no los conoce. El snapshot 0035 es igual al 0034. Si cambia o se
-- borra alguna de estas columnas en `catalog_products` (tenant_id, alegra_id, stock, raw, status,
-- alegra_status, alegra_leido_at), recrear la vista en la MISMA migración (DROP VIEW + CREATE VIEW
-- + GRANT).
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que la lee):
--   REVOKE SELECT ON public.catalog_products_shop FROM shop_app;
--   DROP VIEW public.catalog_products_shop;
-- (en una migración nueva, append-only; nunca editar ésta).
CREATE VIEW "public"."catalog_products_shop" AS
SELECT tenant_id,
       alegra_id,
       stock,
       coalesce(raw->'price', '[]'::jsonb) AS precios_alegra,
       (status = 'active' AND coalesce(alegra_status, 'active') <> 'inactive') AS activo,
       alegra_leido_at
FROM "public"."catalog_products";
--> statement-breakpoint
-- GRANT condicional: crm_test y las ramas sin el rol no lo tienen. Si el rol se crea DESPUÉS de
-- esta migración, correr este bloque a mano como owner (ver apps/admin/docs/FUNCIONALIDADES.md,
-- "Vista de catálogo para el Shop").
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop" TO shop_app;
  END IF;
END $$;
