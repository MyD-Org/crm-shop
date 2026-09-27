-- Ficha técnica (PDF) por producto, en el overlay comercial del catálogo (change
-- `ficha-tecnica-producto`).
--
-- Escrita a mano, como 0014-0039: los snapshots de drizzle-kit quedaron congelados en 0013 y
-- `db:generate` regeneraría todo desde ahí.
--
-- Aditiva: una sola columna nueva, nullable, sin DROP. Igual que `fotos`, se guarda la KEY del
-- objeto en R2 y no la URL (se compone al leer, en `urlPublicaFicha()`); a diferencia de `fotos`
-- es un solo archivo, no un array de variantes, así que es un objeto o null.
--
-- Grants: NO hace falta una migración nueva. El Shop (`shop_app`) ya tiene GRANT SELECT sobre
-- TODA la tabla `catalog_overlay` desde la migración 0038 (tabla completa, no por columna), así
-- que una columna nueva queda cubierta automáticamente.

ALTER TABLE "catalog_overlay" ADD COLUMN IF NOT EXISTS "ficha_tecnica" jsonb;

ALTER TABLE "catalog_overlay" DROP CONSTRAINT IF EXISTS "catalog_overlay_ficha_tecnica_object";
ALTER TABLE "catalog_overlay" ADD CONSTRAINT "catalog_overlay_ficha_tecnica_object"
  CHECK ("ficha_tecnica" IS NULL OR jsonb_typeof("ficha_tecnica") = 'object');
