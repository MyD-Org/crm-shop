-- Teléfonos del espejo de contactos para el Shop, change `contacto-fuente-unica` (extensión
-- teléfonos, 2026-09-24). Decisión de la usuaria: el espejo es la única fuente de los datos del
-- contacto y el Shop no pide lo que el espejo ya tiene. El checkout pedía "Teléfono" aunque el
-- contacto de Alegra del cliente vinculado ya tuviera uno.
--
-- La vista `alegra_contacts_shop` suma AL FINAL `phone_primary`, `phone_secondary` y `mobile`
-- (27 + 3 = 30), tal cual los guarda la sync (texto de Alegra, sin normalizar). Sigue sin `raw`,
-- sin `phones_norm` (búsqueda interna del CRM) y sin `seller_id`. Se recrea (DROP + CREATE) con
-- las 27 columnas de 0034 en el MISMO orden y se re-concede el SELECT (el DROP se lo lleva).
--
-- La función `shop_contacto_write_through` (0034) NO cambia: su guarda "sólo completar vacíos"
-- no mira teléfonos y el UPDATE no toca las columnas de teléfono (quedan al día con el webhook o
-- la sync). Por eso el Shop sólo escribe un teléfono en Alegra cuando los tres del espejo están
-- vacíos.
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0035): la vista y el GRANT no están en
-- src/db/schema.ts. El snapshot 0036 es igual al 0035.
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que las lee; en una migración
-- nueva, append-only):
--   DROP VIEW public.alegra_contacts_shop;
--   CREATE VIEW public.alegra_contacts_shop AS SELECT <las 27 columnas de 0034>
--     FROM public.alegra_contacts;
--   GRANT SELECT ON public.alegra_contacts_shop TO shop_app;
DROP VIEW "public"."alegra_contacts_shop";
--> statement-breakpoint
CREATE VIEW "public"."alegra_contacts_shop" AS
SELECT tenant_id, alegra_account, alegra_id, name, identification, identification_norm,
       email, emails_norm, types, price_list_id, price_list_name, price_list_status,
       tipo_cuenta, alegra_status, status, synced_at,
       seller_name, payment_term_name, payment_term_days, credit_limit,
       iva_condition, identification_type, identification_number,
       address_street, address_city, address_province, address_postal_code,
       phone_primary, phone_secondary, mobile
FROM "public"."alegra_contacts";
--> statement-breakpoint
-- GRANT condicional: crm_test y las ramas sin el rol no lo tienen. Si el rol se crea DESPUÉS
-- de esta migración, correr este bloque a mano como owner (ver apps/admin/docs/FUNCIONALIDADES.md,
-- "Espejo de contactos de Alegra"). El DROP VIEW de arriba se llevó el SELECT de 0034.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."alegra_contacts_shop" TO shop_app;
  END IF;
END $$;
