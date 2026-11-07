-- Marca por dominio (change `marca-por-dominio`, rebanada S1): el Shop necesita leer
-- `tenants.shop_destinos_extra` para saber si el dominio en el que corre tiene marca, tema y
-- remitente propios (claves opcionales `marca`, `tema`, `remitente` de cada destino extra).
--
-- GRANT: `shop_app` lee SÓLO esta columna, además de las que ya tenía (0032, 0078, 0085, 0086).
-- La columna no guarda secretos (el secreto de cada extra vive en el env del admin).
-- Condicional como en 0085: crm_test y las ramas sin el rol no lo tienen.
-- Drift sólo en SQL: el GRANT (drizzle-kit no lo conoce). Sin cambios en schema.ts.
--
-- Reversa (en una migración nueva, SOLO después de sacar la lectura del código del Shop):
--   REVOKE SELECT (shop_destinos_extra) ON public.tenants FROM shop_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT (shop_destinos_extra) ON "public"."tenants" TO shop_app;
  END IF;
END $$;
