-- Cuenta de cobro por intento (change cuentas-procesador-por-sucursal, rebanada R2).
-- ADITIVA: dos columnas text nullable en pago_intentos, sin default, sin CHECK, sin índice ni relleno.
--   - cuenta: slug de la sucursal cuya cuenta de Mercado Pago / Payway cobró (o intentó cobrar) el intento.
--   - cuenta_prevista: la que le correspondía al pedido (facturaSucursal ?? sucursal ?? predeterminada).
--   Distintas = cobro con otra cuenta (fallback). Filas cerradas con detalle 'credenciales_rechazadas:<cuenta>'
--   son la evidencia de que el procesador rechazó las credenciales de esa cuenta en ese pedido.
--   NULL en ambas = intento anterior a esta migración: el código deriva la cuenta del pedido.
--
-- El código escribe las columnas al reservar el intento: esta migración tiene que correr ANTES de
-- desplegar el código (db:migrate no corre en el deploy). El código anterior las ignora.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta): las columnas pueden quedar
-- sin uso; si hiciera falta borrarlas:
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "cuenta_prevista";
--   ALTER TABLE "shop"."pago_intentos" DROP COLUMN "cuenta";
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "cuenta" text;--> statement-breakpoint
ALTER TABLE "shop"."pago_intentos" ADD COLUMN "cuenta_prevista" text;
