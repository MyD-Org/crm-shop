-- Con qué pagó el comprador (detalle del pedido en el CRM).
-- ADITIVA: dos columnas jsonb nullable, sin relleno.
--   - pago_intentos.info: marca, tipo (crédito/débito/prepaga/dinero en cuenta), últimos 4, fecha de
--     aprobación, código de autorización y cupón, según la respuesta del proveedor. Nunca el titular ni el BIN.
--   - orders.pago_info: copia del intento que decide el estado del pago (como pago_cuotas).
--   NULL = pago anterior a esta migración o proveedor que no lo informó: el CRM muestra lo que haya.
--
-- El código escribe las dos columnas al registrar cada cobro: esta migración tiene que correr ANTES de
-- desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."orders" DROP COLUMN "pago_info";
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "info";
ALTER TABLE "shop"."orders" ADD COLUMN "pago_info" jsonb;--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "info" jsonb;