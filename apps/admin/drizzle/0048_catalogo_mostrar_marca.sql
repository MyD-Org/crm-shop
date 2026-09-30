-- Interruptor por producto para no exhibir la marca en el Shop (p. ej. las pantallas GRASS).
-- - `catalog_overlay.mostrar_marca boolean NOT NULL DEFAULT true`: false = el Shop no muestra la
--   marca del producto (card, ficha, metadatos ni filtro de marcas).
-- GRANT a `shop_app`: SELECT por COLUMNA (patrón de 0038/0045), condicional al rol.
-- Rollback: ALTER TABLE "catalog_overlay" DROP COLUMN "mostrar_marca";

ALTER TABLE "catalog_overlay" ADD COLUMN "mostrar_marca" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ("mostrar_marca") ON "public"."catalog_overlay" TO shop_app;
  END IF;
END $$;
