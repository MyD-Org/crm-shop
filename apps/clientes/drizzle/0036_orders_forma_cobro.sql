-- Forma de pago congelada en el pedido (change `listas-por-forma-de-pago`, rebanada C).
-- ADITIVA para los datos: una columna nullable y el CHECK de `pago_revision` ampliado con un valor.
--   - forma_cobro: credito | debito | cuenta_mp. Es la forma con la que se cotizó y congeló el total;
--     SOLO se guarda cuando el medio tiene precios distintos por forma. NULL = pedido anterior a esta
--     migración o medio sin precios por forma: el cobro no valida la forma.
--   - pago_revision: se suma `forma_distinta` (el pago aprobado no es de la forma congelada). Lo
--     reemplaza el CHECK; ningún valor existente deja de valer.
--
-- Esta migración tiene que correr ANTES de desplegar el código (db:migrate no corre en el deploy). El
-- CRM reconoce `forma_distinta` en la misma rebanada.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   UPDATE "shop"."orders" SET "pago_revision" = NULL WHERE "pago_revision" = 'forma_distinta';
--   ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_pago_revision_check";
--   ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_pago_revision_check" CHECK ("shop"."orders"."pago_revision" is null or "shop"."orders"."pago_revision" in ('cobro_duplicado','pagado_cancelado','cuotas_distintas','monto_distinto'));
--   ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_forma_cobro_check";
--   ALTER TABLE "shop"."orders" DROP COLUMN "forma_cobro";
ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_pago_revision_check";--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "forma_cobro" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_forma_cobro_check" CHECK ("shop"."orders"."forma_cobro" is null or "shop"."orders"."forma_cobro" in ('credito','debito','cuenta_mp'));--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_pago_revision_check" CHECK ("shop"."orders"."pago_revision" is null or "shop"."orders"."pago_revision" in ('cobro_duplicado','pagado_cancelado','cuotas_distintas','monto_distinto','forma_distinta'));