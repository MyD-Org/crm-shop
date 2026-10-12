-- El padre de un producto con variantes nunca es vendible (change `variantes-de-producto`, S2).
--
-- `catalog_products_shop.activo` suma `AND tipo <> 'padre'`: así el código del Shop que hoy está en
-- producción (que sólo mira `activo`) tampoco vende ni lista un padre, sin tocar una línea del Shop. Es
-- el único cambio de significado de una columna existente, y es seguro: hoy no hay padres marcados
-- (la columna `tipo` es de 0080, default 'simple').
--
-- La vista conserva sus 12 columnas, el orden y los tipos (CREATE OR REPLACE VIEW lo exige) y los
-- GRANT: se re-concede SELECT a `shop_app` en el mismo bloque condicional de 0035/0065 (idempotente).
-- `catalog_products_shop_privados` NO cambia: un padre no tiene precios online privados.
--
-- Requiere 0080 (usa la columna `tipo`). Aplicar en staging y prod ANTES de mergear el código.
--
-- Reversa (en una migración nueva; nunca editar ésta): CREATE OR REPLACE VIEW public.catalog_products_shop
-- con el SELECT de 0065 (sin `AND tipo <> 'padre'` en `activo`), más el mismo bloque GRANT.

CREATE OR REPLACE VIEW "public"."catalog_products_shop" AS
SELECT tenant_id,
       alegra_id,
       stock,
       precios_online AS precios_alegra,
       (status = 'active' AND coalesce(alegra_status, 'active') <> 'inactive' AND tipo <> 'padre') AS activo,
       alegra_leido_at,
       name,
       description,
       code,
       brand,
       category_alegra_id,
       iva_porcentaje
FROM "public"."catalog_products";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop" TO shop_app;
  END IF;
END $$;
