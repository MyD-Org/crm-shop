-- Catálogo del Shop desde el CRM (change `catalogo-shop-desde-crm`, PR-1a).
--
-- El Shop (apps/clientes) va a leer el producto entero de las vistas del CRM y dejar su propio
-- espejo de Alegra. Esta migración prepara ese contrato, SIN romper al Shop que hoy lee las 6
-- columnas de 0035:
--   1. `precios_alegra` pasa a ser una columna GENERADA STORED de catalog_products (la vista ya no
--      destoastea `raw` en cada lectura). Reescribe la tabla una vez: aplicar fuera de pico y lejos
--      de la sync de las 07:00 UTC.
--   2. `alegra_suma_impuestos(jsonb)`: regla única de impuestos (la SUMA de raw.tax). Es el espejo
--      exacto de sumaImpuestos (src/lib/alegra-impuestos.ts); los ata el vector
--      src/lib/__fixtures__/impuestos-alegra.json. Sin permiso para PUBLIC ni para shop_app.
--   3. Backfill único de iva_porcentaje (antes se guardaba "el mayor"). Idempotente: sólo toca las
--      filas que cambian; se puede re-correr a mano (el statement marcado `backfill-iva`).
--   4. `catalog_products_shop` suma, AL FINAL, name, description, code, brand, category_alegra_id,
--      iva_porcentaje (OR REPLACE: las 6 de 0035 quedan iguales, en el mismo orden y tipo).
--   5. Vista nueva `catalog_categories_shop`.
--   6. GRANT condicional a shop_app sobre las dos vistas (NADA sobre las tablas).
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0035): la función, las dos vistas y los GRANTs
-- no están en src/db/schema.ts. La columna generada SÍ está (schema.ts + snapshot 0037).
--
-- Orden: se aplica en prod ANTES de abrir el PR que la trae (el código viejo sigue andando: la
-- columna generada no se escribe y la vista conserva sus 6 columnas).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del Shop que lee las vistas;
-- nunca editar ésta):
--   DROP VIEW public.catalog_categories_shop;
--   DROP VIEW public.catalog_products_shop;
--   CREATE VIEW public.catalog_products_shop AS  -- el SELECT de 0035
--     SELECT tenant_id, alegra_id, stock, coalesce(raw->'price', '[]'::jsonb) AS precios_alegra,
--            (status = 'active' AND coalesce(alegra_status, 'active') <> 'inactive') AS activo,
--            alegra_leido_at
--     FROM public.catalog_products;
--   GRANT SELECT ON public.catalog_products_shop TO shop_app;  -- si el rol existe
--   ALTER TABLE public.catalog_products DROP COLUMN precios_alegra;
--   DROP FUNCTION public.alegra_suma_impuestos(jsonb);
-- El IVA no se "des-suma": la próxima sync con el código viejo vuelve a "el mayor".
ALTER TABLE "public"."catalog_products"
  ADD COLUMN "precios_alegra" jsonb GENERATED ALWAYS AS (coalesce("raw"->'price', '[]'::jsonb)) STORED;
--> statement-breakpoint
-- Regla: tax no array → null; cuenta `percentage` si es número JSON o string que, sin espacios
-- (U+0020) en los extremos, es un decimal simple; ninguno cuenta → null; si no, la suma.
-- btrim sin segundo argumento sólo quita espacios; `->` sobre un escalar da NULL; sum de 0 filas
-- da NULL.
CREATE FUNCTION "public"."alegra_suma_impuestos"(p_tax jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT sum(CASE jsonb_typeof(e->'percentage')
               WHEN 'number' THEN (e->>'percentage')::numeric
               ELSE btrim(e->>'percentage')::numeric END)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_tax) = 'array' THEN p_tax ELSE '[]'::jsonb END) AS e
  WHERE jsonb_typeof(e->'percentage') = 'number'
     OR (jsonb_typeof(e->'percentage') = 'string'
         AND btrim(e->>'percentage') ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$')
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."alegra_suma_impuestos"(jsonb) FROM PUBLIC;
--> statement-breakpoint
-- backfill-iva
UPDATE "public"."catalog_products"
SET iva_porcentaje = "public"."alegra_suma_impuestos"(raw->'tax')
WHERE raw IS NOT NULL
  AND iva_porcentaje IS DISTINCT FROM "public"."alegra_suma_impuestos"(raw->'tax')::numeric(5,2);
--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."catalog_products_shop" AS
SELECT tenant_id,
       alegra_id,
       stock,
       precios_alegra,
       (status = 'active' AND coalesce(alegra_status, 'active') <> 'inactive') AS activo,
       alegra_leido_at,
       name,
       description,
       code,
       brand,
       category_alegra_id,
       iva_porcentaje
FROM "public"."catalog_products";
--> statement-breakpoint
CREATE VIEW "public"."catalog_categories_shop" AS
SELECT tenant_id,
       alegra_id,
       name,
       parent_alegra_id,
       (status = 'active') AS activo
FROM "public"."catalog_categories";
--> statement-breakpoint
-- GRANT condicional (patrón 0035), ÚLTIMO statement: lo lee el test de grants. crm_test y las
-- ramas sin el rol no lo tienen. Si el rol se crea DESPUÉS, correr este bloque a mano como owner
-- (docs/FUNCIONALIDADES.md, "Vista de catálogo para el Shop"). OR REPLACE conserva el SELECT de la
-- vista de productos; se re-concede igual (idempotente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop" TO shop_app;
    GRANT SELECT ON "public"."catalog_categories_shop" TO shop_app;
  END IF;
END $$;
