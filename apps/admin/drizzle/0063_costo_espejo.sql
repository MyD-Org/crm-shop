-- Costo del producto en el espejo del catálogo (change `listas-precio-online`, rebanada A).
--
-- Aditiva: dos columnas nullable en `catalog_products`. Sin GRANT a `shop_app`: el costo vive solo
-- en el CRM (la vista `catalog_products_shop` NO cambia, y `shop_app` no tiene acceso a la tabla).
--
-- - `costo`: costo unitario SIN IVA que informa Alegra (`inventory.unitCost`, se pide con
--   `fields=inventory`). Lo escribe la sync / el webhook con la misma frescura por fila que el
--   resto de las columnas de Alegra. NULL = sin costo (ausente, 0 o inválido; nunca 0).
-- - `costo_aplicado`: el costo sobre el que se calculó el precio vigente. Lo gobierna la rebanada B
--   (retención por variación de costo). Acá solo se inicializa igual a `costo`.
--
-- Backfill: desde `raw->'inventory'->>'unitCost'` con guarda numérica (solo valores > 0 y que
-- entren en numeric(14,4)). Idempotente: solo completa filas con `costo` nulo, y `costo_aplicado`
-- solo donde está nulo. Filas sin unitCost quedan NULL.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que las lee; nunca editar ésta):
--   ALTER TABLE "catalog_products" DROP COLUMN "costo_aplicado";
--   ALTER TABLE "catalog_products" DROP COLUMN "costo";

ALTER TABLE "catalog_products" ADD COLUMN "costo" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "costo_aplicado" numeric(14, 4);
--> statement-breakpoint
UPDATE "catalog_products"
SET "costo" = (("raw" -> 'inventory' ->> 'unitCost')::numeric)::numeric(14, 4)
WHERE "costo" IS NULL
  AND jsonb_typeof("raw" -> 'inventory') = 'object'
  AND ("raw" -> 'inventory' ->> 'unitCost') ~ '^[0-9]{1,9}(\.[0-9]+)?$'
  AND (("raw" -> 'inventory' ->> 'unitCost')::numeric) > 0;
--> statement-breakpoint
UPDATE "catalog_products"
SET "costo_aplicado" = "costo"
WHERE "costo_aplicado" IS NULL AND "costo" IS NOT NULL;
