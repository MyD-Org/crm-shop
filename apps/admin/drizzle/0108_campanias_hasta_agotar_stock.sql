-- Campañas «Hasta agotar stock»: la campaña sigue teniendo fin interno (la columna `fin` es NOT NULL y
-- la ventana manda en el cálculo), pero el cliente ve «Hasta agotar stock» en la ficha en lugar de
-- la fecha y la cuenta regresiva. Sólo cambia la exhibición del Shop.
--
-- campanias_shop: el SELECT de 0095 + hasta_agotar_stock AL FINAL (CREATE OR REPLACE VIEW sólo admite
-- agregar columnas al final). El GRANT de 0095 sigue vigente (CREATE OR REPLACE conserva permisos),
-- igual se repite por si la vista se recreó. Aplicar en prod ANTES de mergear el Shop que la declara.
--
-- Reversa (SOLO después de sacar el código del Shop que la lee): DROP VIEW campanias_shop + CREATE
-- VIEW con el SELECT de 0095 y su GRANT; ALTER TABLE campanias DROP COLUMN hasta_agotar_stock.
ALTER TABLE "campanias" ADD COLUMN "hasta_agotar_stock" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."campanias_shop" AS
SELECT tenant_id, id, nombre, etiqueta, inicio, fin, hasta_agotar_stock
FROM "public"."campanias"
WHERE fin > now() - interval '24 hours';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ON "public"."campanias_shop" TO shop_app;
  END IF;
END $$;
