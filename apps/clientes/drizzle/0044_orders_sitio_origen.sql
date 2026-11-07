-- Sitio donde se hizo el pedido (change `dominios`, rebanada S3a). El mismo código corre en más de
-- un dominio y los mails del pedido tienen que linkear al sitio de compra.
-- ADITIVA: una columna nullable, sin default y sin backfill. NULL = pedido anterior: los mails usan
-- el sitio del entorno, como hasta ahora.
--
-- Esta migración tiene que correr ANTES de desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta), sólo después de que el
-- CRM deje de leer la columna:
--   ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_sitio_origen_check";
--   ALTER TABLE "shop"."orders" DROP COLUMN "sitio_origen";
ALTER TABLE "shop"."orders" ADD COLUMN "sitio_origen" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_sitio_origen_check" CHECK ("shop"."orders"."sitio_origen" is null or "shop"."orders"."sitio_origen" ~ '^https?://[^/[:space:]]+$');