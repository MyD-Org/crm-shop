-- Intención del cobro en cuotas (change cuotas-en-el-formulario, rebanada 3).
-- ADITIVA: tres columnas nullable en pago_intentos, sin default ni relleno.
--   - cuotas_solicitadas: cuotas que se le pidieron al procesador en este intento.
--   - total_esperado: monto que se le mandó al procesador (el total del pedido; con cuotas con interés,
--     el precio de 1 pago: el interés lo agrega el procesador).
--   - con_interes: true = cuotas con interés del procesador elegidas por el comprador.
--   NULL = intento anterior a esta migración o recuperado por el webhook sin reserva: la reconciliación
--   sigue con las reglas de antes (contra las cuotas y el total congelados en el pedido).
--
-- El código escribe las columnas al reservar el intento: esta migración tiene que correr ANTES de
-- desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "con_interes";
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "total_esperado";
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "cuotas_solicitadas";
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "cuotas_solicitadas" integer;--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "total_esperado" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "con_interes" boolean;