-- Plazo de despacho configurable desde el CRM (sección "Envíos", tarjeta "Plazo de despacho").
--
-- Solo ESTRUCTURA y defaults que reproducen lo que el Shop muestra hoy: cero datos reales.
--
-- Extiende `reglas_venta` (UNA fila por tenant):
-- - `despacho_visible` (default true): si el Shop muestra el plazo de despacho del envío a
--   domicilio ("Despacho dentro de las 24 h hábiles") en la ficha, el carrito y el checkout.
-- - `despacho_dias_habiles` (default 1): días hábiles desde la compra. 1 se muestra como
--   "24 h hábiles"; N > 1 como "N días hábiles". Si hay que traer el producto de otra sucursal se
--   suma `traslado_dias`.
-- Con los defaults el Shop se ve igual que antes de esta migración.
--
-- GRANT a `shop_app`: el SELECT de tabla de 0045 ya cubre las columnas nuevas; el bloque DO $$ es
-- idempotente y deja la intención registrada. Si el rol se crea DESPUÉS de esta migración, correr
-- el bloque a mano como owner (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0050): el CHECK y el GRANT no están en src/db/schema.ts.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "reglas_venta" DROP COLUMN "despacho_visible", DROP COLUMN "despacho_dias_habiles";
--   (el CHECK cae con la columna).

ALTER TABLE "reglas_venta" ADD COLUMN "despacho_visible" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "despacho_dias_habiles" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD CONSTRAINT "reglas_venta_despacho_dias_check" CHECK ("despacho_dias_habiles" BETWEEN 1 AND 30);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."reglas_venta" TO shop_app;
  END IF;
END $$;
