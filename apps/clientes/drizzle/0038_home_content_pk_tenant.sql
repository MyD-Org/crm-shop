-- home_content: PK compuesta (tenant_id, key) (change `shop-para-avantec`, rebanada 1b, fase CONTRACT).
-- Cierra lo que la 0037 dejó abierto: la PK pasa de `key` a (tenant_id, key), así dos tiendas pueden tener
-- la misma sección (`hero`, `footer`, `pagina:garantia`...), y se quita el DEFAULT de `tenant_id`: toda
-- escritura tiene que indicar su tenant (el código vigente ya lo hace y usa `ON CONFLICT (tenant_id, key)`).
--
-- Se reutiliza el índice único `home_content_tenant_key` de la 0037 (`ADD CONSTRAINT ... PRIMARY KEY USING
-- INDEX`): no se reconstruye nada, y el índice queda renombrado como `home_content_pkey`. DROP de la PK vieja
-- y ADD de la nueva ocurren en una sola sentencia/transacción: la tabla (~11 filas) toma un lock exclusivo
-- sólo el instante del cambio y nunca queda sin PK. Con ella aplicada, el código viejo (`ON CONFLICT (key)`)
-- ya no tendría arbiter, pero el vigente desde la 0037 no lo usa; el `ON CONFLICT (tenant_id, key)` sigue
-- valiendo contra la PK nueva.
--
-- Filas con `tenant_id` NULL: RAISE EXCEPTION (no se inventa un tenant). Idempotente: si la PK ya es
-- (tenant_id, key) sólo se asegura que no quede DEFAULT.
--
-- Esta migración tiene que correr ANTES de mergear el PR de esta rebanada (db:migrate no corre en el deploy).
-- Sondear la base destino y confirmar antes de aplicarla.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta). SÓLO mientras no haya dos
-- tenants con la misma key (si no, la PK(key) no se puede crear):
--   ALTER TABLE "shop"."home_content" DROP CONSTRAINT "home_content_pkey";
--   ALTER TABLE "shop"."home_content" ADD CONSTRAINT "home_content_pkey" PRIMARY KEY ("key");
--   CREATE UNIQUE INDEX "home_content_tenant_key" ON "shop"."home_content" ("tenant_id", "key");
--   (y, si se quiere el estado de la 0037, volver a poner el DEFAULT de tenant_id con el slug de la base).
DO $$
DECLARE
  sin_tenant bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = '"shop"."home_content"'::regclass
      AND i.indisprimary
      AND i.indnatts = 2
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
           WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['key', 'tenant_id']
  ) THEN
    SELECT count(*) INTO sin_tenant FROM "shop"."home_content" WHERE "tenant_id" IS NULL;
    IF sin_tenant > 0 THEN
      RAISE EXCEPTION 'home_content tiene % fila(s) sin tenant: no se puede armar la PK (tenant_id, key). Completar a mano y registrar la migración.',
        sin_tenant;
    END IF;
    ALTER TABLE "shop"."home_content" ALTER COLUMN "tenant_id" SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "home_content_tenant_key" ON "shop"."home_content" USING btree ("tenant_id","key");
    ALTER TABLE "shop"."home_content"
      DROP CONSTRAINT IF EXISTS "home_content_pkey",
      ADD CONSTRAINT "home_content_pkey" PRIMARY KEY USING INDEX "home_content_tenant_key";
  END IF;
  ALTER TABLE "shop"."home_content" ALTER COLUMN "tenant_id" DROP DEFAULT;
END
$$;
