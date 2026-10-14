-- Marca de la tienda de cada empresa (change `shop-para-avantec`, rebanada 3a).
--
-- `shop_marca`: objeto JSON con la marca que el Shop muestra (nombre, título, descripción, logos,
-- favicon, imagen OG, textos de la imagen OG, email de contacto y `base`, que elige los textos de
-- partida: "central" = los de hoy, "generica" = neutros). TODAS las claves son opcionales; '{}'
-- (el valor por defecto) = el Shop se ve exactamente como antes. La forma y la validación viven en
-- src/lib/tienda-online.ts; el Shop la vuelve a sanear al leerla.
--
-- GRANT: el Shop (`shop_app`) lee SÓLO esta columna, además de las que ya tenía (0032, 0078).
-- Condicional como en 0078: crm_test y las ramas sin el rol no lo tienen.
-- Drift sólo en SQL: el GRANT (drizzle-kit no lo conoce).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del Shop que la lee):
--   REVOKE SELECT (shop_marca) ON public.tenants FROM shop_app;
--   ALTER TABLE public.tenants DROP COLUMN shop_marca;
ALTER TABLE "tenants" ADD COLUMN "shop_marca" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT (shop_marca) ON "public"."tenants" TO shop_app;
  END IF;
END $$;
