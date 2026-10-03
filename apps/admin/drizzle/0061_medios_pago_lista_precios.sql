-- Listas de precios por medio de pago (change `listas-por-medio-de-pago`, rebanada A).
--
-- Aditiva: 4 columnas en `medios_pago_shop` y un índice único parcial. Sin cambios de GRANT: la
-- 0046 concedió a `shop_app` SELECT de la TABLA completa, que cubre las columnas nuevas.
--
-- - `id_lista_precios` / `lista_precios_nombre`: lista de Alegra (cuenta principal) enlazada al
--   medio y snapshot de su nombre. NULL = el medio usa la lista por defecto.
-- - `destacar_en_catalogo`: a lo sumo UN medio por tenant (índice único parcial); el Shop muestra
--   "$X con <Medio>" bajo el precio de las cards.
-- - `mostrar_en_ficha`: cualquier cantidad de medios, sin índice único; la ficha muestra una línea
--   por cada medio marcado.
-- Las filas existentes quedan con lista NULL y ambos flags en false.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP INDEX "medios_pago_shop_tenant_destacado_uniq";
--   ALTER TABLE "medios_pago_shop" DROP COLUMN "id_lista_precios", DROP COLUMN "lista_precios_nombre",
--     DROP COLUMN "destacar_en_catalogo", DROP COLUMN "mostrar_en_ficha";

ALTER TABLE "medios_pago_shop" ADD COLUMN "id_lista_precios" text;
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD COLUMN "lista_precios_nombre" text;
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD COLUMN "destacar_en_catalogo" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD COLUMN "mostrar_en_ficha" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "medios_pago_shop_tenant_destacado_uniq" ON "medios_pago_shop" USING btree ("tenant_id") WHERE "destacar_en_catalogo" = true;
