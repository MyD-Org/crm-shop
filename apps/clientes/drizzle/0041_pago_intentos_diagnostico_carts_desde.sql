-- Diagnóstico de errores del proveedor de pago y antigüedad del carrito (change admin-carritos-intentos-pago, S1).
-- ADITIVA: tres columnas nullable y un CHECK de largo; el Shop viejo y el nuevo conviven con ella aplicada.
--   - shop.pago_intentos.error_proveedor / error_status: último fallo del proveedor en ese intento (texto
--     SANEADO por lista blanca, <= 500 caracteres, sin PII) y su HTTP. NULL = sin error registrado; los
--     intentos históricos quedan en NULL (sin backfill). El CHECK es la red de seguridad del saneo.
--   - shop.carts.con_items_desde: desde cuándo el carrito tiene ítems. NULL = vacío. El backfill deja los
--     carritos con ítems existentes en `updated_at` (mejor aproximación disponible).
--
-- Correr ANTES de desplegar el código (db:migrate no corre en el deploy; el código adelantado al esquema
-- rompe el Shop porque drizzle selecciona columnas explícitas): primero Neon staging y prod, después el merge.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."pago_intentos" DROP CONSTRAINT "pago_intentos_error_proveedor_largo_check";
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "error_status";
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "error_proveedor";
--   ALTER TABLE "shop"."carts" DROP COLUMN "con_items_desde";
ALTER TABLE "shop"."carts" ADD COLUMN "con_items_desde" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "error_proveedor" text;--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "error_status" integer;--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD CONSTRAINT "pago_intentos_error_proveedor_largo_check" CHECK (char_length("shop"."pago_intentos"."error_proveedor") <= 500);--> statement-breakpoint
UPDATE "shop"."carts" SET "con_items_desde" = "updated_at" WHERE jsonb_array_length("items") > 0;
