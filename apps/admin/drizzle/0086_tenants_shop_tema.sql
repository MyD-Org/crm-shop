-- Tema de la tienda de cada empresa (change `shop-para-avantec`, rebanada 4a).
--
-- `shop_tema`: objeto JSON con la paleta del Shop: `base` ("calido-azul" = el tema de hoy, o
-- "calido") y `colores` (ocho colores #rrggbb: bg, surface, text, muted, primary, onPrimary, accent,
-- surfaceDark; el Shop deriva el resto de los tokens). TODAS las claves son opcionales; '{}' (el
-- valor por defecto) = el Shop conserva su tema de hoy. La forma y la validación (formato y
-- contraste WCAG) viven en src/lib/tienda-online.ts y src/lib/tema-contraste.ts; el Shop la vuelve
-- a sanear al leerla.
--
-- GRANT: el Shop (`shop_app`) lee SÓLO esta columna, además de las que ya tenía (0032, 0078, 0085).
-- Condicional como en 0078/0085: crm_test y las ramas sin el rol no lo tienen.
-- Drift sólo en SQL: el GRANT (drizzle-kit no lo conoce).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del Shop que la lee):
--   REVOKE SELECT (shop_tema) ON public.tenants FROM shop_app;
--   ALTER TABLE public.tenants DROP COLUMN shop_tema;
ALTER TABLE "tenants" ADD COLUMN "shop_tema" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT (shop_tema) ON "public"."tenants" TO shop_app;
  END IF;
END $$;
