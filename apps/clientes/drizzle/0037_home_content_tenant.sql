-- home_content con tenant (change `shop-para-avantec`, rebanada 1a, fase EXPAND).
-- La tabla pasa a ser de una tienda (tenant) y no de la base entera; hasta ahora había una sola.
--
-- ADITIVA y compatible en los dos sentidos con el despliegue (por eso la PK sigue siendo `key`):
--   - tenant_id text NOT NULL. Las filas existentes se completan con el tenant que ya usa esta base:
--     el ÚNICO tenant_id distinto de shop.orders / shop.clientes / shop.carts. El slug NO está en este
--     archivo (repo público): se infiere de los datos.
--   - Con ese tenant único, queda además como DEFAULT de la columna (se arma con format(%L)), para que el
--     código viejo, que inserta sin tenant_id, siga andando hasta que se despliegue el nuevo.
--   - Base vacía (local / crm_test, 0 tenants) y tabla vacía: sólo NOT NULL, sin default.
--   - Más de un tenant, o filas sin tenant que no se pueden atribuir: RAISE EXCEPTION. Se resuelve a mano
--     (UPDATE + marker en shop.__drizzle_migrations, receta drizzle-migrations-desync).
--   - Índice único (tenant_id, key): respalda el `ON CONFLICT (tenant_id, key)` del código nuevo. El
--     `ON CONFLICT (key)` del código viejo sigue valiendo por la PK(key).
--   - Idempotente: una segunda corrida no cambia nada.
--
-- DRIFT SOLO-SQL (como la 0036): el DEFAULT dinámico de tenant_id no se puede modelar en schema.ts. La 0038
-- (rebanada 1b) pasa la PK a (tenant_id, key) y lo quita.
--
-- Esta migración tiene que correr ANTES de desplegar el código (db:migrate no corre en el deploy).
-- Sondear la base destino y confirmar antes de aplicarla.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   DROP INDEX "shop"."home_content_tenant_key";
--   ALTER TABLE "shop"."home_content" DROP COLUMN "tenant_id";
ALTER TABLE "shop"."home_content" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
DO $$
DECLARE
  slugs text[];
  sin_tenant bigint;
BEGIN
  SELECT coalesce(array_agg(DISTINCT t), ARRAY[]::text[]) INTO slugs
  FROM (
    SELECT "tenant_id" AS t FROM "shop"."orders"
    UNION
    SELECT "tenant_id" FROM "shop"."clientes"
    UNION
    SELECT "tenant_id" FROM "shop"."carts"
  ) x
  WHERE t IS NOT NULL;

  SELECT count(*) INTO sin_tenant FROM "shop"."home_content" WHERE "tenant_id" IS NULL;

  IF cardinality(slugs) = 1 THEN
    UPDATE "shop"."home_content" SET "tenant_id" = slugs[1] WHERE "tenant_id" IS NULL;
    EXECUTE format('ALTER TABLE "shop"."home_content" ALTER COLUMN "tenant_id" SET DEFAULT %L', slugs[1]);
  ELSIF sin_tenant > 0 THEN
    RAISE EXCEPTION 'home_content tiene % fila(s) sin tenant y no se puede inferir uno (tenants en la base: %). Completar a mano y registrar la migración.',
      sin_tenant, cardinality(slugs);
  END IF;

  ALTER TABLE "shop"."home_content" ALTER COLUMN "tenant_id" SET NOT NULL;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "home_content_tenant_key" ON "shop"."home_content" USING btree ("tenant_id","key");
