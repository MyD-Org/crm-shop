-- Avisos del pedido sin cobro en línea con espera (change `avisos-al-salir`).
-- ADITIVA: una columna nullable y el relleno de los pedidos existentes.
--   - avisos_enviados_en: cuándo salieron "Recibimos su pedido" (comprador) y "Nuevo pedido" (local).
--     Con transferencia ya no salen al crear el pedido: salen al irse de la pantalla de transferencia,
--     al informar el comprobante o desde el cron a los 15 minutos, con el medio que tenga el pedido.
--     NULL = todavía no salieron.
--   - Relleno: los pedidos existentes SIN cobro en línea quedan como ya avisados (su created_at). Sin
--     esto, el cron mandaría avisos de pedidos viejos. Los de cobro en línea quedan en NULL: si alguno
--     pendiente pasa a un medio sin cobro en línea, sus avisos tienen que salir.
--
-- El código lee y escribe la columna: esta migración tiene que correr ANTES de desplegar el código
-- (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   ALTER TABLE "shop"."orders" DROP COLUMN "avisos_enviados_en";
ALTER TABLE "shop"."orders" ADD COLUMN "avisos_enviados_en" timestamp with time zone;--> statement-breakpoint
UPDATE "shop"."orders" SET "avisos_enviados_en" = "created_at"
  WHERE "avisos_enviados_en" IS NULL AND "pago_metodo" NOT IN ('mercadopago', 'payway');
