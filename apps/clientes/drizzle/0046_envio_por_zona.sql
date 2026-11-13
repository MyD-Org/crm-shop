-- Envío por zona con tarifa (change `envio-por-zona-con-tarifa`, rebanada B).
-- ADITIVA: columnas nullable, sin default y sin backfill. NULL = retiro, envío a coordinar o pedido
-- anterior. `orders.envio_*` es el snapshot del método de envío (el CRM lo lee para la factura y el
-- detalle); `direcciones_envio.lat/lon` guardan la ubicación verificada de una dirección (ambas o ninguna).
--
-- Orden de despliegue: CRM 0101 -> esta -> código (db:migrate no corre en el deploy). Con el flag
-- `envio-por-zona` apagado el código no lee ni escribe estas columnas.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta), sólo después de sacar el código:
--   ALTER TABLE "shop"."direcciones_envio" DROP CONSTRAINT "dir_envio_lat_lon_check";
--   ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_envio_confirmado_check";
--   ALTER TABLE "shop"."direcciones_envio" DROP COLUMN "lat", DROP COLUMN "lon";
--   ALTER TABLE "shop"."orders" DROP COLUMN "envio_metodo", DROP COLUMN "envio_zona", DROP COLUMN "envio_promesa",
--     DROP COLUMN "envio_entrega_estimada", DROP COLUMN "envio_confirmado_en", DROP COLUMN "envio_entrega_confirmada",
--     DROP COLUMN "envio_detalle";
ALTER TABLE "shop"."direcciones_envio" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "shop"."direcciones_envio" ADD COLUMN "lon" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_metodo" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_zona" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_promesa" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_entrega_estimada" date;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_confirmado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_entrega_confirmada" date;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "envio_detalle" jsonb;--> statement-breakpoint
ALTER TABLE "shop"."direcciones_envio" ADD CONSTRAINT "dir_envio_lat_lon_check" CHECK (("shop"."direcciones_envio"."lat" is null and "shop"."direcciones_envio"."lon" is null) or ("shop"."direcciones_envio"."lat" is not null and "shop"."direcciones_envio"."lon" is not null and "shop"."direcciones_envio"."lat" between -56 and -21 and "shop"."direcciones_envio"."lon" between -74 and -53));--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_envio_confirmado_check" CHECK ("shop"."orders"."envio_entrega_confirmada" is null or "shop"."orders"."envio_confirmado_en" is not null);