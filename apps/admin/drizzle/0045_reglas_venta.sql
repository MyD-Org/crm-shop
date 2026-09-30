-- Reglas de venta por tenant y visibilidad por sucursal (change `sucursales-igz-mdp`, rebanada B).
--
-- Solo ESTRUCTURA y valores por defecto: cero datos reales. Las reglas se editan en el admin
-- (Configuración > Sucursales y ventas); el repo es público.
--
-- - `reglas_venta`: UNA fila por tenant (PK tenant_id). Disponibilidad (`respaldo_envio`,
--   `retiro_sin_stock`, `traslado_dias`), reserva (`reserva_dias`, 0 = nunca vence) y contacto
--   (`aviso_sin_contactar_horas`, `contacto_horas_habiles`). Los defaults son los del design (sí,
--   ofrecer, 7, 7, 24, 24). CHECK: enteros >= 0 y `retiro_sin_stock` en ('bloquear','ofrecer').
--   Se siembra una fila con los defaults por cada tenant existente; si falta la fila (tenant nuevo)
--   el código de las dos apps usa los mismos defaults.
-- - `catalog_overlay.oculto_en_sucursales text[] NOT NULL DEFAULT '{}'`: slugs de `sucursales` donde
--   el producto NO se ofrece (vacío = visible en todas). Sin FK (los arrays no la admiten): la API
--   del admin valida los slugs. NO se modifica la vista `catalog_products_shop`: el Shop lee el
--   overlay directo, como `visible` y las fotos.
--
-- GRANT a `shop_app` (el Shop las lee, no las escribe), condicional como 0035/0038:
--   - `reglas_venta`: SELECT de la tabla (nada sensible).
--   - `catalog_overlay.oculto_en_sucursales`: SELECT por COLUMNA (patrón de 0038). En prod 0038 ya
--     concedió SELECT sobre TODA la tabla, así que es redundante ahí; sirve si algún día se pasa a
--     grants por columna en el overlay y deja la intención registrada.
-- Si el rol se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0035/0037/0038/0041): los CHECK de `reglas_venta`,
-- la siembra de filas y los GRANTs no están en src/db/schema.ts. El snapshot 0045 solo suma la
-- tabla y la columna.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP TABLE "reglas_venta"; ALTER TABLE "catalog_overlay" DROP COLUMN "oculto_en_sucursales";
--   (o dejar la columna inerte: con el flag `disponibilidad-sucursal` apagado el Shop la ignora).

CREATE TABLE "reglas_venta" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"respaldo_envio" boolean DEFAULT true NOT NULL,
	"retiro_sin_stock" text DEFAULT 'ofrecer' NOT NULL,
	"traslado_dias" integer DEFAULT 7 NOT NULL,
	"reserva_dias" integer DEFAULT 7 NOT NULL,
	"aviso_sin_contactar_horas" integer DEFAULT 24 NOT NULL,
	"contacto_horas_habiles" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reglas_venta_enteros_check" CHECK ("traslado_dias" >= 0 AND "reserva_dias" >= 0 AND "aviso_sin_contactar_horas" >= 0 AND "contacto_horas_habiles" >= 0),
	CONSTRAINT "reglas_venta_retiro_sin_stock_check" CHECK ("retiro_sin_stock" IN ('bloquear', 'ofrecer'))
);
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD CONSTRAINT "reglas_venta_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "catalog_overlay" ADD COLUMN "oculto_en_sucursales" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
INSERT INTO "reglas_venta" ("tenant_id") SELECT "id" FROM "tenants" ON CONFLICT ("tenant_id") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."reglas_venta" TO shop_app;
    GRANT SELECT ("oculto_en_sucursales") ON "public"."catalog_overlay" TO shop_app;
  END IF;
END $$;
