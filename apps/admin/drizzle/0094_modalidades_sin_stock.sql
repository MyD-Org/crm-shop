-- Modalidades de venta sin stock (feature "venta sin stock por modalidad").
--
-- Solo ESTRUCTURA: cero datos reales. Las modalidades se editan en el admin; el repo es público.
--
-- - `modalidades_sin_stock`: catálogo por tenant de las formas de vender un producto sin stock.
--   `nombre` es interno (único por tenant, nunca viaja al navegador del comprador); `texto` es lo que
--   ve el comprador (1..40 caracteres); `plazo_dias` es opcional (NULL = sin plazo, 1..60);
--   `flujo` es 'en_linea' (se cobra/confirma en línea) o 'a_confirmar'; `activa` es el interruptor
--   de corte (default true).
-- - `catalog_overlay.modalidad_sin_stock_id`: modalidad asignada al producto. NULL = sin modalidad
--   (comportamiento de hoy). `ON DELETE SET NULL`: borrar la modalidad deja al producto sin ella.
--
-- GRANT a `shop_app` (el Shop las lee, no las escribe), condicional al rol como 0045/0087:
--   - `modalidades_sin_stock`: SELECT de la tabla.
--   - `catalog_overlay.modalidad_sin_stock_id`: SELECT por COLUMNA.
-- Si el rol se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Orden de despliegue: aplicar 0094 (CRM) → 0039 del Shop (`apps/clientes/drizzle`,
-- `shop.order_items.venta_sin_stock`) → recién ahí mergear/desplegar las dos apps. 0039 va ANTES del
-- deploy del CRM porque el detalle del pedido lee `shop.order_items` con `getTableColumns`
-- (src/lib/pedidos-repo.ts, `itemsDe`): sin la columna, esa consulta falla. Sin 0094 el Shop sigue
-- andando (lectura tolerante = sin modalidades).
--
-- Drift que vive SOLO en SQL (como 0045/0087): los tres CHECK de `modalidades_sin_stock` y los GRANT
-- no están en src/db/schema.ts.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   REVOKE SELECT ("modalidad_sin_stock_id") ON "public"."catalog_overlay" FROM shop_app;
--   REVOKE SELECT ON "public"."modalidades_sin_stock" FROM shop_app;
--   ALTER TABLE "catalog_overlay" DROP COLUMN "modalidad_sin_stock_id";
--   DROP TABLE "modalidades_sin_stock";

CREATE TABLE "modalidades_sin_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"nombre" text NOT NULL,
	"texto" text NOT NULL,
	"plazo_dias" integer,
	"flujo" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modalidades_sin_stock_tenant_nombre_uniq" UNIQUE ("tenant_id", "nombre"),
	CONSTRAINT "modalidades_sin_stock_plazo_dias_check" CHECK ("plazo_dias" IS NULL OR "plazo_dias" BETWEEN 1 AND 60),
	CONSTRAINT "modalidades_sin_stock_flujo_check" CHECK ("flujo" IN ('en_linea', 'a_confirmar')),
	CONSTRAINT "modalidades_sin_stock_texto_check" CHECK (char_length("texto") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "modalidades_sin_stock" ADD CONSTRAINT "modalidades_sin_stock_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "catalog_overlay" ADD COLUMN "modalidad_sin_stock_id" uuid;
--> statement-breakpoint
ALTER TABLE "catalog_overlay" ADD CONSTRAINT "catalog_overlay_modalidad_sin_stock_id_modalidades_sin_stock_id_fk" FOREIGN KEY ("modalidad_sin_stock_id") REFERENCES "public"."modalidades_sin_stock"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."modalidades_sin_stock" TO shop_app;
    GRANT SELECT ("modalidad_sin_stock_id") ON "public"."catalog_overlay" TO shop_app;
  END IF;
END $$;
