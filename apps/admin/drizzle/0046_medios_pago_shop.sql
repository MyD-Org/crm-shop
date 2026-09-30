-- Medios de pago del checkout y mensaje de confirmación (change `sucursales-igz-mdp`, rebanada C).
--
-- Solo ESTRUCTURA y semilla neutra: cero datos reales (los textos con datos bancarios, CBU, etc.
-- se cargan por el admin; el repo es público).
--
-- - `medios_pago_shop`: medios que el Shop ofrece en el checkout. Tabla APARTE de `payment_methods`
--   (esa es de proveedores de cuotas; decisión O10 cerrada: no se toca). `slug` es lo que el Shop
--   guarda en `shop.orders.pago_metodo` (texto, sin FK entre esquemas): inmutable; un medio usado
--   por algún pedido se desactiva, no se borra. `instrucciones` = texto que ve el cliente al
--   elegirlo. `cobro_online` reservado (sin uso todavía). UNIQUE (tenant_id, slug) y CHECK del slug.
--   Semilla por cada tenant existente: transferencia, efectivo en el local y tarjeta en el local
--   (los dos últimos solo retiro), activos y sin cobro online. Un tenant nuevo los carga por el
--   admin.
-- - `reglas_venta.mensaje_confirmacion`: texto de la confirmación de compra; vacío = mensaje por
--   defecto del Shop. Variables `{plazo}` y `{whatsapp}` que reemplaza el Shop.
--
-- GRANT a `shop_app` (el Shop las lee, no las escribe), condicional como 0035/0038/0045:
--   - `medios_pago_shop`: SELECT de la tabla (nada sensible).
--   - `reglas_venta.mensaje_confirmacion`: NO hace falta GRANT nuevo. La 0045 concedió SELECT sobre
--     la TABLA `reglas_venta` completa, que cubre la columna nueva (verificado: `has_column_privilege`
--     da true para `shop_app`). Queda documentado acá.
-- Si el rol se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0041/0045): el CHECK del slug, la siembra y el GRANT no
-- están en src/db/schema.ts. El snapshot 0046 solo suma la tabla, su índice y la columna.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP TABLE "medios_pago_shop"; ALTER TABLE "reglas_venta" DROP COLUMN "mensaje_confirmacion";

CREATE TABLE "medios_pago_shop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"nombre" text NOT NULL,
	"instrucciones" text DEFAULT '' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"aplica_retiro" boolean DEFAULT true NOT NULL,
	"aplica_envio" boolean DEFAULT true NOT NULL,
	"cobro_online" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medios_pago_shop_slug_check" CHECK ("slug" ~ '^[a-z0-9-]{2,30}$')
);
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD CONSTRAINT "medios_pago_shop_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "medios_pago_shop_tenant_slug_uniq" ON "medios_pago_shop" USING btree ("tenant_id","slug");
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "mensaje_confirmacion" text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO "medios_pago_shop" ("tenant_id", "slug", "nombre", "aplica_envio", "orden")
SELECT t."id", m."slug", m."nombre", m."aplica_envio", m."orden"
FROM "tenants" t
CROSS JOIN (VALUES
  ('transferencia', 'Transferencia bancaria', true, 0),
  ('efectivo', 'Efectivo en el local', false, 1),
  ('tarjeta-local', 'Tarjeta en el local', false, 2)
) AS m ("slug", "nombre", "aplica_envio", "orden")
ON CONFLICT ("tenant_id", "slug") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."medios_pago_shop" TO shop_app;
  END IF;
END $$;
