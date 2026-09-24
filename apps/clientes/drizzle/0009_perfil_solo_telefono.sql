-- 0009 (change contacto-fuente-unica): perfil de facturación "sólo teléfono".
-- El comprador vinculado a Alegra factura con los datos del espejo del CRM; si no
-- tiene perfil y guarda su teléfono, se crea una fila sin documento, razón social
-- ni condición. Compatible hacia atrás: el código anterior nunca crea filas así,
-- por eso se puede aplicar antes del merge.
-- Reversa (sólo si no quedaron filas sin esos datos):
--   DELETE FROM shop.billing_profiles WHERE tipo_doc IS NULL OR nro_doc IS NULL
--     OR razon_social IS NULL OR condicion_iva IS NULL;
--   ALTER TABLE shop.billing_profiles ALTER COLUMN tipo_doc SET NOT NULL, ... (las 4).
ALTER TABLE "shop"."billing_profiles" ALTER COLUMN "tipo_doc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop"."billing_profiles" ALTER COLUMN "nro_doc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop"."billing_profiles" ALTER COLUMN "razon_social" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop"."billing_profiles" ALTER COLUMN "condicion_iva" DROP NOT NULL;