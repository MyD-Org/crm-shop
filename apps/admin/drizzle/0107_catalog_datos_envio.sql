-- Datos de envío por producto (peso y medidas con embalaje, unidad mínima, unidades por caja master).
-- Sirven para calcular el envío más adelante; hoy NO se muestran en la tienda.
-- - Tabla aparte del overlay (`catalog_overlay`) a propósito: escribirla no bumpea el updated_at
--   del overlay (no dispara el delta hacia el Shop) y la sync de Alegra no la pisa (no es
--   `catalog_products`). Una fila por (tenant, producto); sin FK a catalog_products (puede
--   preceder al espejo, como el overlay).
-- - Medidas en cm y peso en kg de la UNIDAD DE VENTA EMBALADA (no del producto suelto).
-- - `fuente`: de dónde salió el dato ('coresa' = índice interno del proveedor, 'manual').
-- - SIN GRANT a `shop_app`: el Shop no los lee todavía. El REVOKE es cinturón por si algún
--   DEFAULT PRIVILEGES del esquema public le diera algo al crear la tabla.
-- Rollback: DROP TABLE "catalog_datos_envio";

CREATE TABLE IF NOT EXISTS "catalog_datos_envio" (
	"tenant_id" text NOT NULL REFERENCES "tenants"("id"),
	"alegra_id" text NOT NULL,
	"peso_kg" numeric(10, 3),
	"alto_cm" numeric(8, 2),
	"ancho_cm" numeric(8, 2),
	"largo_cm" numeric(8, 2),
	"unidad_minima" integer,
	"unidades_por_caja" integer,
	"fuente" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_datos_envio_pk" PRIMARY KEY ("tenant_id", "alegra_id"),
	CONSTRAINT "catalog_datos_envio_positivos" CHECK (
		(peso_kg IS NULL OR peso_kg > 0) AND (alto_cm IS NULL OR alto_cm > 0) AND
		(ancho_cm IS NULL OR ancho_cm > 0) AND (largo_cm IS NULL OR largo_cm > 0) AND
		(unidad_minima IS NULL OR unidad_minima > 0) AND (unidades_por_caja IS NULL OR unidades_por_caja > 0)
	)
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    REVOKE ALL ON "public"."catalog_datos_envio" FROM shop_app;
  END IF;
END $$;
