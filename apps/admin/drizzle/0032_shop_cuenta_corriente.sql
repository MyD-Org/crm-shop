-- Cuenta corriente del cliente en "Mi cuenta" del Shop (apps/clientes), change `portal-al-shop`.
--
-- Drift que vive SOLO en SQL (como 0031): ni la vista ni los GRANTs están en src/db/schema.ts;
-- drizzle-kit no los conoce. El snapshot 0032 es igual al 0031.
--
-- 1. La vista `alegra_contacts_shop` suma 4 columnas NO sensibles que el Shop necesita para
--    Condiciones y la barra de límite de crédito: seller_name, payment_term_name,
--    payment_term_days, credit_limit. Sigue sin `raw`, sin teléfonos y sin seller_id.
--    Postgres no deja agregar columnas a una vista con CREATE OR REPLACE salvo al final y sin
--    cambiar las existentes; se recrea entera (DROP + CREATE) y se re-concede el SELECT.
-- 2. Todos los permisos nuevos del rol `shop_app` sobre `public`, mínimos y por columna.
--    SIN DELETE en ninguna tabla. En payment_receipts el UPDATE se limita a las columnas que
--    escribe el flujo de informar pago (claim, release, reject, publish, lease y resultado del
--    mail): nunca loaded_*, alegra_payment_*, declared_*, amount ni codigocliente.
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que los usa):
--   REVOKE UPDATE ON public.payment_receipts FROM shop_app;
--   REVOKE SELECT, INSERT ON public.payment_receipts FROM shop_app;
--   REVOKE SELECT, UPDATE ON public.notification_log FROM shop_app;
--   REVOKE SELECT ON public.client_commercial_conditions FROM shop_app;
--   REVOKE SELECT ON public.tenants FROM shop_app;
-- Volver la vista a 16 columnas = migración nueva append-only (DROP + CREATE + GRANT).
DROP VIEW "public"."alegra_contacts_shop";
--> statement-breakpoint
CREATE VIEW "public"."alegra_contacts_shop" AS
SELECT tenant_id, alegra_account, alegra_id, name, identification, identification_norm,
       email, emails_norm, types, price_list_id, price_list_name, price_list_status,
       tipo_cuenta, alegra_status, status, synced_at,
       seller_name, payment_term_name, payment_term_days, credit_limit
FROM "public"."alegra_contacts";
--> statement-breakpoint
-- GRANT condicional: crm_test y las ramas sin el rol no lo tienen. Si el rol se crea DESPUÉS
-- de esta migración, correr este bloque a mano como owner (ver apps/admin/docs/FUNCIONALIDADES.md,
-- "Espejo de contactos de Alegra").
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."alegra_contacts_shop" TO shop_app;
    GRANT SELECT (id, name, whatsapp_number, receipts_email) ON "public"."tenants" TO shop_app;
    GRANT SELECT ON "public"."client_commercial_conditions" TO shop_app;
    GRANT SELECT, UPDATE (read_at) ON "public"."notification_log" TO shop_app;
    GRANT SELECT, INSERT ON "public"."payment_receipts" TO shop_app;
    GRANT UPDATE (status, processing_started_at, reject_reason, file_key, file_mime, file_size,
                  file_sha256, converted_from, email_status, email_error, email_sent_at,
                  email_attempts, email_last_attempt_at, submitted_at, updated_at)
      ON "public"."payment_receipts" TO shop_app;
  END IF;
END $$;
