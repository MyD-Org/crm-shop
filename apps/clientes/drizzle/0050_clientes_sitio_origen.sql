-- Tienda de origen de cada usuario del espejo de Clerk (`shop.clientes.sitio_origen`).
--
-- El mismo código del Shop corre en más de un dominio del tenant (centralled y luzatlantica), cada
-- uno con su instancia de Clerk: un usuario pertenece a UN solo sitio. Hasta acá el CRM no podía
-- distinguirlos en "Clientes de la tienda". Formato = `orders.sitio_origen` (0044): el origen del
-- despliegue (`NEXT_PUBLIC_SITE_URL` normalizada), nunca un header del request.
--
--   - Columna nullable con CHECK de formato. null = fila anterior sin backfill.
--   - `shop.clientes_upsert_clerk` de 7 argumentos (`p_sitio`): lo guarda al insertar y, en un
--     update, sólo pisa con un valor no nulo. La de 6 argumentos (0018) queda para el código
--     anterior a este deploy; se borra en una migración aparte.
--   - Backfill parcial y determinístico: los usuarios con pedidos toman el sitio de su primer
--     pedido con `sitio_origen` (el clerk_user_id es de esa instancia de Clerk). El resto se
--     completa corriendo `npm run clientes:backfill` con el entorno de cada proyecto de Vercel.
--
-- ADITIVA: el código anterior sigue funcionando. Correr ANTES de desplegar el código.
--
-- Reversa (a mano, en una migración nueva, después de sacar el código):
--   DROP FUNCTION "shop"."clientes_upsert_clerk"(text, text, text, text, timestamptz, timestamptz, text);
--   ALTER TABLE "shop"."clientes" DROP CONSTRAINT "sc_sitio_origen";
--   ALTER TABLE "shop"."clientes" DROP COLUMN "sitio_origen";
ALTER TABLE "shop"."clientes" ADD COLUMN "sitio_origen" text;--> statement-breakpoint
ALTER TABLE "shop"."clientes" ADD CONSTRAINT "sc_sitio_origen" CHECK ("shop"."clientes"."sitio_origen" is null or "shop"."clientes"."sitio_origen" ~ '^https?://[^/[:space:]]+$');--> statement-breakpoint
CREATE FUNCTION "shop"."clientes_upsert_clerk"(
  p_tenant text, p_clerk_user_id text, p_email text, p_nombre text,
  p_creado timestamptz, p_actualizado timestamptz, p_sitio text
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
    (tenant_id, clerk_user_id, email, email_norm, nombre, creado_en_clerk, actualizado_en_clerk, sitio_origen)
  VALUES (p_tenant, p_clerk_user_id, NULLIF(btrim(p_email), ''),
          NULLIF(lower(btrim(p_email)), ''), NULLIF(btrim(p_nombre), ''), p_creado, p_actualizado,
          NULLIF(btrim(p_sitio), ''))
  ON CONFLICT (tenant_id, clerk_user_id) DO UPDATE SET
    email = excluded.email, email_norm = excluded.email_norm, nombre = excluded.nombre,
    creado_en_clerk = coalesce(c.creado_en_clerk, excluded.creado_en_clerk),
    actualizado_en_clerk = excluded.actualizado_en_clerk,
    sitio_origen = coalesce(excluded.sitio_origen, c.sitio_origen),
    updated_at = now()
  WHERE c.eliminado_en IS NULL AND c.actualizado_en_clerk <= excluded.actualizado_en_clerk
  RETURNING (xmax = 0) INTO v_insertado;
  IF NOT FOUND THEN RETURN 'ignorado'; END IF;
  RETURN CASE WHEN v_insertado THEN 'insertado' ELSE 'actualizado' END;
END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "shop"."clientes_upsert_clerk"(text, text, text, text, timestamptz, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT EXECUTE ON FUNCTION "shop"."clientes_upsert_clerk"(text, text, text, text, timestamptz, timestamptz, text) TO shop_app;
  END IF;
END $$;--> statement-breakpoint
UPDATE "shop"."clientes" c SET sitio_origen = o.sitio_origen
FROM (
  SELECT DISTINCT ON (tenant_id, clerk_user_id) tenant_id, clerk_user_id, sitio_origen
  FROM "shop"."orders"
  WHERE clerk_user_id IS NOT NULL AND sitio_origen IS NOT NULL
  ORDER BY tenant_id, clerk_user_id, created_at
) o
WHERE c.tenant_id = o.tenant_id AND c.clerk_user_id = o.clerk_user_id AND c.sitio_origen IS NULL;
