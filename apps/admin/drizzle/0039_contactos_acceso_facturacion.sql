-- Excepción de acceso a Facturación por CONTACTO de Alegra, change `clientes-tienda-admin` (R4a).
--
-- Hoy "Facturación" de Mi cuenta del Shop se muestra sólo si el contacto vinculado está en
-- cuenta corriente. Decisión de la usuaria: un admin/superadmin del CRM puede otorgar el acceso
-- a un contacto (la EMPRESA, no la persona) de contado, con quién y cuándo, y quitarlo después.
--
-- `contactos_acceso_facturacion`: una fila por otorgamiento. Quitar = UPDATE de revocado_* (nunca
-- DELETE: el historial queda). A lo sumo UNA vigente por (tenant, cuenta, contacto): índice
-- parcial `caf_vigente`, que además sirve al EXISTS de la vista. otorgado_por / revocado_por sin
-- FK a admin_users (nombre congelado; el historial sobrevive a la baja del usuario).
--
-- La vista `alegra_contacts_shop` suma AL FINAL `acceso_facturacion` (30 + 1 = 31) = cuenta
-- corriente O excepción vigente. Es la ÚNICA definición de la regla: el Shop la lee (desde R4b)
-- y el listado "Clientes de la tienda" del admin también. Se recrea (DROP + CREATE) con las 30
-- columnas de 0036 en el MISMO orden y se re-concede el SELECT (el DROP se lo lleva). La vista
-- corre con los privilegios de su dueño (security_invoker = false, el default), así que shop_app
-- NO necesita permiso sobre la tabla nueva y NO se le da (la tabla guarda quién otorgó).
-- `status` no entra en la columna: el Shop ya filtra `status = 'active'` en cada lectura.
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0036/0038): la vista, el CHECK
-- `caf_revocacion_completa` y el GRANT no están en src/db/schema.ts. La tabla y el índice sí
-- (snapshot 0039).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del Shop y del CRM que
-- leen la columna o escriben la tabla; nunca editar ésta):
--   DROP VIEW public.alegra_contacts_shop;
--   CREATE VIEW public.alegra_contacts_shop AS SELECT <las 30 columnas de 0036>
--     FROM public.alegra_contacts;
--   GRANT SELECT ON public.alegra_contacts_shop TO shop_app;
--   DROP TABLE public.contactos_acceso_facturacion;
CREATE TABLE "contactos_acceso_facturacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alegra_account" text DEFAULT 'principal' NOT NULL,
	"alegra_id" text NOT NULL,
	"otorgado_por" uuid NOT NULL,
	"otorgado_por_nombre" text NOT NULL,
	"otorgado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"revocado_por" uuid,
	"revocado_por_nombre" text,
	"revocado_en" timestamp with time zone,
	CONSTRAINT "caf_revocacion_completa" CHECK (("revocado_en" IS NULL) = ("revocado_por" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "contactos_acceso_facturacion" ADD CONSTRAINT "contactos_acceso_facturacion_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "caf_vigente" ON "contactos_acceso_facturacion" USING btree ("tenant_id","alegra_account","alegra_id") WHERE "revocado_en" IS NULL;--> statement-breakpoint
DROP VIEW "public"."alegra_contacts_shop";
--> statement-breakpoint
CREATE VIEW "public"."alegra_contacts_shop" AS
SELECT ac.tenant_id, ac.alegra_account, ac.alegra_id, ac.name, ac.identification, ac.identification_norm,
       ac.email, ac.emails_norm, ac.types, ac.price_list_id, ac.price_list_name, ac.price_list_status,
       ac.tipo_cuenta, ac.alegra_status, ac.status, ac.synced_at,
       ac.seller_name, ac.payment_term_name, ac.payment_term_days, ac.credit_limit,
       ac.iva_condition, ac.identification_type, ac.identification_number,
       ac.address_street, ac.address_city, ac.address_province, ac.address_postal_code,
       ac.phone_primary, ac.phone_secondary, ac.mobile,
       (coalesce(ac.tipo_cuenta = 'corriente', false) OR EXISTS (
          SELECT 1 FROM "public"."contactos_acceso_facturacion" e
          WHERE e.tenant_id = ac.tenant_id
            AND e.alegra_account = ac.alegra_account
            AND e.alegra_id = ac.alegra_id
            AND e.revocado_en IS NULL
       )) AS acceso_facturacion
FROM "public"."alegra_contacts" ac;
--> statement-breakpoint
-- GRANT condicional: crm_test y las ramas sin el rol no lo tienen. Si el rol se crea DESPUÉS
-- de esta migración, correr este bloque a mano como owner (ver apps/admin/docs/FUNCIONALIDADES.md,
-- "Espejo de contactos de Alegra"). El DROP VIEW de arriba se llevó el SELECT de 0036. Sobre
-- contactos_acceso_facturacion NO hay GRANT, a propósito; el REVOKE es cinturón por si algún
-- DEFAULT PRIVILEGES del esquema public le diera algo a shop_app al crear la tabla.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."alegra_contacts_shop" TO shop_app;
    REVOKE ALL ON "public"."contactos_acceso_facturacion" FROM shop_app;
  END IF;
END $$;
