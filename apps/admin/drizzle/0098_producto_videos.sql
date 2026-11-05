-- Videos de YouTube por producto (ficha del Shop).
-- - `catalog_overlay.videos jsonb NOT NULL DEFAULT '[]'`: lista de `{ "id": "<11 caracteres>" }`
--   (máx. 3, sin repetir; la API del admin valida). Sólo se guarda el id: el embed y el poster se
--   componen al leer. Las filas previas quedan en `[]`.
-- GRANT a `shop_app`: SELECT por COLUMNA (patrón de 0038/0045/0048), condicional al rol.
-- Rollback: ALTER TABLE "catalog_overlay" DROP COLUMN "videos";

ALTER TABLE "catalog_overlay" ADD COLUMN "videos" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT ("videos") ON "public"."catalog_overlay" TO shop_app;
  END IF;
END $$;
