-- Espejo de los usuarios de Clerk de la tienda, change `clientes-tienda-admin` (R1).
--
-- `shop.clientes`: una fila por (tenant, usuario de Clerk), para que el CRM sepa quién se registró
-- en la tienda sin tener clave de Clerk. La alimentan el webhook `/api/webhooks/clerk` del Shop
-- (user.created, user.updated, user.deleted) y el backfill `npm run clientes:backfill`, los dos a
-- través de las DOS funciones de abajo (nunca con INSERT/UPDATE sueltos):
--   - `shop.clientes_upsert_clerk`: upsert por (tenant_id, clerk_user_id) que sólo pisa si el
--     `updated_at` de Clerk que llega es >= al guardado (eventos desordenados o repetidos) y nunca
--     sobre una fila eliminada. Devuelve 'insertado' | 'actualizado' | 'ignorado' | 'rechazado'.
--   - `shop.clientes_eliminar_clerk`: baja. Deja la fila con `eliminado_en` y SIN email, email_norm
--     ni nombre (PII anonimizada; el CHECK `sc_eliminado_sin_datos` lo garantiza). Si no había fila,
--     inserta una ya anonimizada (tombstone) para que un evento viejo no la cree después.
--     Devuelve 'eliminado'.
-- `cl_usuario_fecha` sirve al listado del CRM (último vínculo de cada usuario, en cualquier estado).
--
-- Las funciones, los REVOKE y el bloque de GRANTs están escritos A MANO al final: drizzle no los
-- modela (drift que vive sólo en SQL, como en 0016). Los prueba
-- apps/admin/test/integration/shop-clientes-espejo.integration.test.ts contra Postgres real.
--
-- Reversa (a mano, SOLO después de revertir el código del Shop y del CRM que la usan), en una
-- migración nueva, append-only; nunca editar ésta:
--   DROP FUNCTION "shop"."clientes_upsert_clerk"(text, text, text, text, timestamptz, timestamptz);
--   DROP FUNCTION "shop"."clientes_eliminar_clerk"(text, text);
--   DROP INDEX "shop"."cl_usuario_fecha";
--   DROP TABLE "shop"."clientes";
CREATE TABLE "shop"."clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text,
	"email_norm" text,
	"nombre" text,
	"creado_en_clerk" timestamp with time zone,
	"actualizado_en_clerk" timestamp with time zone NOT NULL,
	"eliminado_en" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_largos" CHECK (char_length(coalesce("shop"."clientes"."email", '')) <= 254 and char_length(coalesce("shop"."clientes"."nombre", '')) <= 200),
	CONSTRAINT "sc_eliminado_sin_datos" CHECK ("shop"."clientes"."eliminado_en" IS NULL OR ("shop"."clientes"."email" IS NULL AND "shop"."clientes"."email_norm" IS NULL AND "shop"."clientes"."nombre" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sc_tenant_usuario" ON "shop"."clientes" USING btree ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "sc_tenant_alta" ON "shop"."clientes" USING btree ("tenant_id","creado_en_clerk");--> statement-breakpoint
CREATE INDEX "cl_usuario_fecha" ON "shop"."client_links" USING btree ("clerk_user_id","created_at");--> statement-breakpoint
-- Upsert del espejo. `<=` y no `<`: la re-entrega de un evento idéntico es idempotente.
-- `xmax = 0` distingue la fila recién insertada de la actualizada. Si el WHERE del DO UPDATE no
-- se cumple (evento viejo o fila eliminada) no hay fila en el RETURNING ⇒ 'ignorado'.
CREATE FUNCTION "shop"."clientes_upsert_clerk"(
  p_tenant text, p_clerk_user_id text, p_email text, p_nombre text,
  p_creado timestamptz, p_actualizado timestamptz
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_insertado boolean;
BEGIN
  IF p_tenant IS NULL OR p_clerk_user_id IS NULL OR p_actualizado IS NULL THEN
    RETURN 'rechazado';
  END IF;
  INSERT INTO shop.clientes AS c
    (tenant_id, clerk_user_id, email, email_norm, nombre, creado_en_clerk, actualizado_en_clerk)
  VALUES (p_tenant, p_clerk_user_id, NULLIF(btrim(p_email), ''),
          NULLIF(lower(btrim(p_email)), ''), NULLIF(btrim(p_nombre), ''), p_creado, p_actualizado)
  ON CONFLICT (tenant_id, clerk_user_id) DO UPDATE SET
    email = excluded.email, email_norm = excluded.email_norm, nombre = excluded.nombre,
    creado_en_clerk = coalesce(c.creado_en_clerk, excluded.creado_en_clerk),
    actualizado_en_clerk = excluded.actualizado_en_clerk, updated_at = now()
  WHERE c.eliminado_en IS NULL AND c.actualizado_en_clerk <= excluded.actualizado_en_clerk
  RETURNING (xmax = 0) INTO v_insertado;
  IF NOT FOUND THEN RETURN 'ignorado'; END IF;
  RETURN CASE WHEN v_insertado THEN 'insertado' ELSE 'actualizado' END;
END
$fn$;
--> statement-breakpoint
-- Baja: anonimiza y marca. `coalesce` conserva la fecha de la primera baja si se repite.
CREATE FUNCTION "shop"."clientes_eliminar_clerk"(p_tenant text, p_clerk_user_id text) RETURNS text
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO shop.clientes AS c (tenant_id, clerk_user_id, actualizado_en_clerk, eliminado_en)
  VALUES (p_tenant, p_clerk_user_id, now(), now())
  ON CONFLICT (tenant_id, clerk_user_id) DO UPDATE SET
    email = NULL, email_norm = NULL, nombre = NULL,
    eliminado_en = coalesce(c.eliminado_en, now()), updated_at = now()
  RETURNING 'eliminado';
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "shop"."clientes_upsert_clerk"(text, text, text, text, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "shop"."clientes_eliminar_clerk"(text, text) FROM PUBLIC;--> statement-breakpoint
-- Cinturón (patrón 0012/0016): los DEFAULT PRIVILEGES del esquema ya le dan acceso a `shop_app`
-- sobre la tabla si la crea el rol dueño; el EXECUTE de las funciones sí hace falta (el REVOKE de
-- arriba se lo saca a PUBLIC). Sin DELETE: la baja anonimiza, no borra. Condicional: las bases sin
-- el rol (crm_test) no lo tienen. Si el rol se crea DESPUÉS de esta migración, correr este bloque
-- a mano (docs/una-base-esquema-shop.md).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "shop"."clientes" TO shop_app;
    GRANT EXECUTE ON FUNCTION "shop"."clientes_upsert_clerk"(text, text, text, text, timestamptz, timestamptz) TO shop_app;
    GRANT EXECUTE ON FUNCTION "shop"."clientes_eliminar_clerk"(text, text) TO shop_app;
  END IF;
END $$;
