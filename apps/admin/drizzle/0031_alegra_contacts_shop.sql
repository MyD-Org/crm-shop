-- Vista de contactos de Alegra para el Shop (apps/clientes), change `espejo-contactos-alegra`.
--
-- Drift que vive SOLO en SQL: la vista no está declarada en src/db/schema.ts (drizzle-kit no
-- la conoce). Contrato CRM → Shop: el Shop la declara en apps/clientes/src/db/crm.ts con
-- `.existing()` y la lee con el rol `shop_app`, que tiene SELECT sobre la vista y NADA sobre
-- la tabla `alegra_contacts`.
--
-- Columnas acotadas a propósito: sin `raw`, sin teléfonos, sin vendedor ni límite de
-- crédito. Si cambia o se borra alguna de estas columnas en `alegra_contacts`, recrear la
-- vista en la MISMA migración (DROP VIEW + CREATE VIEW + GRANT).
CREATE VIEW "public"."alegra_contacts_shop" AS
SELECT tenant_id, alegra_account, alegra_id, name, identification, identification_norm,
       email, emails_norm, types, price_list_id, price_list_name, price_list_status,
       tipo_cuenta, alegra_status, status, synced_at
FROM "public"."alegra_contacts";
--> statement-breakpoint
-- GRANT condicional: la base de test (crm_test) y las ramas sin el rol no lo tienen. Si el
-- rol se crea DESPUÉS de esta migración, el GRANT se corre a mano (ver
-- apps/admin/docs/FUNCIONALIDADES.md, "Espejo de contactos de Alegra").
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."alegra_contacts_shop" TO shop_app;
  END IF;
END $$;
