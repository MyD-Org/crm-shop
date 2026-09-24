-- Datos de facturación del espejo de contactos para el Shop, change `contacto-fuente-unica`.
--
-- 1. Siete columnas GENERADAS desde `raw` (sin backfill ni requests a Alegra): condición de
--    IVA, tipo y número de documento y domicilio. Vacío, espacios, clave ausente, forma
--    inesperada (p. ej. `address` escalar) o raw NULL ⇒ NULL. Se recalculan solas ante
--    cualquier escritura de `raw` (sync, fallback, webhook, write-through). Van en UN solo
--    ALTER: una sola reescritura de la tabla (lock breve).
-- 2. La vista `alegra_contacts_shop` suma esas 7 columnas AL FINAL (20 + 7). Sigue sin `raw`,
--    sin teléfonos y sin seller_id. Se recrea (DROP + CREATE) y se re-concede el SELECT.
-- 3. Función `public.shop_contacto_write_through` (SECURITY DEFINER): después de que el Shop
--    actualiza un contacto en Alegra, deja el espejo al día con la respuesta. Sólo actualiza
--    una fila existente (nunca inserta) y hace cumplir en la base la regla "sólo completar
--    vacíos": si el contacto nuevo pisa o borra un dato de facturación presente, no toca nada.
--    Devuelve 'ok' | 'sin_fila' | 'rechazado'. EXECUTE sólo para `shop_app` (PUBLIC revocado);
--    `shop_app` sigue sin UPDATE directo sobre la tabla.
--
-- Drift que vive SOLO en SQL (como 0031/0032): la vista, la función y los GRANTs no están en
-- src/db/schema.ts. Las 7 columnas generadas SÍ están (generatedAlwaysAs) y en el snapshot 0034.
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que las usa):
--   DROP FUNCTION public.shop_contacto_write_through(text, text, text, jsonb);
--   DROP VIEW public.alegra_contacts_shop;
--   CREATE VIEW public.alegra_contacts_shop AS SELECT <las 20 columnas de 0032>
--     FROM public.alegra_contacts;
--   GRANT SELECT ON public.alegra_contacts_shop TO shop_app;
--   ALTER TABLE public.alegra_contacts DROP COLUMN iva_condition, DROP COLUMN identification_type,
--     DROP COLUMN identification_number, DROP COLUMN address_street, DROP COLUMN address_city,
--     DROP COLUMN address_province, DROP COLUMN address_postal_code;
-- Sin pérdida de datos: todo sale de `raw`.
ALTER TABLE "public"."alegra_contacts"
  ADD COLUMN "iva_condition" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->>'ivaCondition'), '')) STORED,
  ADD COLUMN "identification_type" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->'identificationObject'->>'type'), '')) STORED,
  ADD COLUMN "identification_number" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->'identificationObject'->>'number'), '')) STORED,
  ADD COLUMN "address_street" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->'address'->>'address'), '')) STORED,
  ADD COLUMN "address_city" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->'address'->>'city'), '')) STORED,
  ADD COLUMN "address_province" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->'address'->>'province'), '')) STORED,
  ADD COLUMN "address_postal_code" text GENERATED ALWAYS AS (NULLIF(btrim("raw"->'address'->>'postalCode'), '')) STORED;
--> statement-breakpoint
DROP VIEW "public"."alegra_contacts_shop";
--> statement-breakpoint
CREATE VIEW "public"."alegra_contacts_shop" AS
SELECT tenant_id, alegra_account, alegra_id, name, identification, identification_norm,
       email, emails_norm, types, price_list_id, price_list_name, price_list_status,
       tipo_cuenta, alegra_status, status, synced_at,
       seller_name, payment_term_name, payment_term_days, credit_limit,
       iva_condition, identification_type, identification_number,
       address_street, address_city, address_province, address_postal_code
FROM "public"."alegra_contacts";
--> statement-breakpoint
CREATE FUNCTION "public"."shop_contacto_write_through"(
  p_tenant text, p_account text, p_alegra_id text, p_raw jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_fila public.alegra_contacts%ROWTYPE;
  v_ident text;
  v_viejo text;
  v_nuevo text;
  v_ruta text[];
BEGIN
  -- Entrada: todo presente, un objeto, el mismo id que la fila pedida y con nombre.
  IF p_tenant IS NULL OR p_account IS NULL OR p_alegra_id IS NULL OR p_raw IS NULL
     OR jsonb_typeof(p_raw) <> 'object'
     OR p_raw->>'id' IS DISTINCT FROM p_alegra_id
     OR NULLIF(btrim(p_raw->>'name'), '') IS NULL THEN
    RETURN 'rechazado';
  END IF;

  SELECT * INTO v_fila
  FROM public.alegra_contacts
  WHERE tenant_id = p_tenant AND alegra_account = p_account AND alegra_id = p_alegra_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'sin_fila'; -- nunca INSERT: la fila la crea la sync o el webhook
  END IF;

  -- Identificación con la misma lógica que mapRawContactRow (src/lib/alegra.ts): string o
  -- número tal cual; objeto ⇒ su `number`; vacío ⇒ NULL.
  v_ident := CASE
    WHEN jsonb_typeof(p_raw->'identification') IN ('string', 'number')
      THEN NULLIF(btrim(p_raw->>'identification'), '')
    WHEN jsonb_typeof(p_raw->'identification') = 'object'
         AND jsonb_typeof(p_raw->'identification'->'number') IN ('string', 'number')
      THEN NULLIF(btrim(p_raw->'identification'->>'number'), '')
  END;

  -- Guarda "sólo completar vacíos": cada dato de facturación presente en el espejo tiene que
  -- llegar igual (normalizado). Borrarlo o cambiarlo ⇒ 'rechazado' sin tocar nada.
  IF NULLIF(btrim(v_fila.name), '') IS NOT NULL
     AND btrim(p_raw->>'name') IS DISTINCT FROM btrim(v_fila.name) THEN
    RETURN 'rechazado';
  END IF;
  IF v_fila.identification IS NOT NULL AND v_ident IS DISTINCT FROM btrim(v_fila.identification) THEN
    RETURN 'rechazado';
  END IF;
  FOREACH v_ruta SLICE 1 IN ARRAY ARRAY[
    ARRAY['identificationObject', 'type'],
    ARRAY['identificationObject', 'number'],
    ARRAY['ivaCondition', NULL],
    ARRAY['address', 'address'],
    ARRAY['address', 'city'],
    ARRAY['address', 'province'],
    ARRAY['address', 'postalCode']
  ] LOOP
    IF v_ruta[2] IS NULL THEN
      v_viejo := NULLIF(btrim(v_fila.raw->>v_ruta[1]), '');
      v_nuevo := NULLIF(btrim(p_raw->>v_ruta[1]), '');
    ELSE
      v_viejo := NULLIF(btrim(v_fila.raw->v_ruta[1]->>v_ruta[2]), '');
      v_nuevo := NULLIF(btrim(p_raw->v_ruta[1]->>v_ruta[2]), '');
    END IF;
    IF v_viejo IS NOT NULL AND v_nuevo IS DISTINCT FROM v_viejo THEN
      RETURN 'rechazado';
    END IF;
  END LOOP;

  -- Las columnas generadas se recalculan solas. Email, teléfonos, lista y plazo quedan como
  -- estaban hasta el webhook o la sync (que reescriben lo mismo: idempotente).
  UPDATE public.alegra_contacts SET
    raw = p_raw,
    name = p_raw->>'name',
    identification = v_ident,
    identification_norm = NULLIF(regexp_replace(coalesce(v_ident, ''), '\D', '', 'g'), ''),
    origen = 'write_through',
    synced_at = now()
  WHERE id = v_fila.id;
  RETURN 'ok';
END
$fn$;
--> statement-breakpoint
-- Las funciones nacen ejecutables por PUBLIC: se revoca siempre, exista o no el rol.
REVOKE ALL ON FUNCTION "public"."shop_contacto_write_through"(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
-- GRANT condicional: crm_test y las ramas sin el rol no lo tienen. Si el rol se crea DESPUÉS
-- de esta migración, correr este bloque a mano como owner (ver apps/admin/docs/FUNCIONALIDADES.md,
-- "Espejo de contactos de Alegra"). El DROP VIEW de arriba se llevó el SELECT de 0032.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."alegra_contacts_shop" TO shop_app;
    GRANT EXECUTE ON FUNCTION "public"."shop_contacto_write_through"(text, text, text, jsonb) TO shop_app;
  END IF;
END $$;
