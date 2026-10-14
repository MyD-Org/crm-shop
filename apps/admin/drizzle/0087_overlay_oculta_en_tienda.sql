-- Variantes ocultables en la tienda (change `variantes-ocultables`).
--
-- `oculta_en_tienda`: en la fila del overlay PROPIO de una variante (por `alegra_id` de la variante)
-- indica que esa variante no se muestra en la tienda aunque su modelo sí. Default false = se muestra
-- (opt-out): nada de lo que hoy se ve desaparece. Sólo importa en las variantes agrupadas; el resto
-- del overlay de la variante (visible, nombre, etc.) no cambia. El Shop la lee directo del overlay.
--
-- GRANT: SELECT por COLUMNA a `shop_app`, condicional al rol (patrón 0048/0085): crm_test y las
-- ramas sin el rol no lo tienen. Drift sólo en SQL: el GRANT (drizzle-kit no lo conoce).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del Shop que la lee):
--   REVOKE SELECT (oculta_en_tienda) ON public.catalog_overlay FROM shop_app;
--   ALTER TABLE public.catalog_overlay DROP COLUMN oculta_en_tienda;
ALTER TABLE "catalog_overlay" ADD COLUMN "oculta_en_tienda" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ("oculta_en_tienda") ON "public"."catalog_overlay" TO shop_app;
  END IF;
END $$;
