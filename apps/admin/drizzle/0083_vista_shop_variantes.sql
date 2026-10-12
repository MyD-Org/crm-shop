-- La vista del Shop expone el grupo de variantes (change `variantes-de-producto`, S5a: contrato CRM -> Shop).
--
-- `catalog_products_shop` suma AL FINAL cinco columnas, todas ya derivadas por `recalcularGrupos`
-- (0080 y 0082):
--   tipo               'simple' | 'padre' | 'variante'.
--   grupo_id           grupo EFECTIVO: el manual (`catalog_variantes_manuales`) o el del padre de Alegra;
--                      NULL si el producto se vende suelto (o es el padre).
--   etiqueta           texto de la opción en el selector (la manual si la hay, si no las opciones de Alegra).
--   es_representante   la card del listado cuando el Shop agrupa (true también en los productos sueltos).
--   overlay_alegra_id  coalesce(grupo_id, alegra_id): de quién se lee el overlay (nombre, fotos, ficha,
--                      categoría, visibilidad). Con grupo es el ancla (el padre o la base del grupo manual).
--
-- Sólo las lee el Shop con el flag `variantes-selector` prendido; con el flag apagado el Shop las ignora
-- y se comporta exactamente como antes. Las 12 columnas anteriores conservan nombre, orden y tipo
-- (CREATE OR REPLACE VIEW lo exige) y `activo` sigue excluyendo al padre (0081).
--
-- Permisos: se re-concede SELECT a `shop_app` en el mismo bloque condicional de 0035/0065/0081
-- (idempotente). NO se concede nada sobre `catalog_variantes_manuales`: la vista corre con los
-- privilegios de su dueño y el Shop sólo ve el resultado ya resuelto. `catalog_products_shop_privados`
-- NO cambia (sigue en 4 columnas: ni el grupo ni el tipo salen por ahí).
--
-- Requiere 0080 (tipo, grupo_id, etiqueta, es_representante). Aplicar en staging y prod ANTES de
-- mergear el código del Shop que declara las columnas en `apps/clientes/src/db/crm.ts`.
--
-- Reversa (en una migración nueva; nunca editar ésta): Postgres NO permite quitar columnas con
-- CREATE OR REPLACE VIEW, así que la reversa es DROP VIEW public.catalog_products_shop + CREATE VIEW con
-- el SELECT de 0081 (las 12 columnas) + el mismo bloque GRANT. El Shop ya desplegado con las columnas
-- declaradas dejaría de leer: revertir primero el Shop (o apagar el flag y no declararlas).

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
       iva_porcentaje,
       tipo,
       grupo_id,
       etiqueta,
       es_representante,
       coalesce(grupo_id, alegra_id) AS overlay_alegra_id
FROM "public"."catalog_products";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop" TO shop_app;
  END IF;
END $$;
