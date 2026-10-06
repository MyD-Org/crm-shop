-- Cuotas sin interés congeladas en el pedido (change `listas-precio-online`, rebanada D).
-- ADITIVA para los datos: una columna nullable y el CHECK de `pago_revision` ampliado con dos valores.
--   - cuotas: 1 = un pago; N >= 2 = N cuotas sin interés. El pedido ya cotizó con la lista de esa
--     cantidad (`id_price_list`), así que `total` es el total en cuotas. El cobro tiene que coincidir.
--     NULL = pedido anterior a esta migración o creado con el flag `cuotas-cobro` apagado: el cobro
--     sigue con el clamp de siempre. Los pedidos con plan congelado (`cuotas_max`, `cuotas_plan`) se
--     leen igual: esas columnas quedan.
--   - pago_revision: se suman `cuotas_distintas` y `monto_distinto` (el cobro en cuotas no coincide con
--     lo congelado). Los reemplaza el CHECK; ningún valor existente deja de valer.
--
-- El código escribe `cuotas` en cada pedido con cobro en línea y el flag prendido, y los dos valores
-- nuevos al reconciliar: esta migración tiene que correr ANTES de desplegar el código (db:migrate no
-- corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta; antes, limpiar las filas
-- con los dos valores nuevos o el CHECK viejo falla):
--   UPDATE "shop"."orders" SET "pago_revision" = NULL WHERE "pago_revision" IN ('cuotas_distintas','monto_distinto');
--   ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_pago_revision_check";
--   ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_pago_revision_check" CHECK ("shop"."orders"."pago_revision" is null or "shop"."orders"."pago_revision" in ('cobro_duplicado','pagado_cancelado'));
--   ALTER TABLE "shop"."orders" DROP COLUMN "cuotas";
ALTER TABLE "shop"."orders" DROP CONSTRAINT "orders_pago_revision_check";--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "cuotas" integer;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_pago_revision_check" CHECK ("shop"."orders"."pago_revision" is null or "shop"."orders"."pago_revision" in ('cobro_duplicado','pagado_cancelado','cuotas_distintas','monto_distinto'));
