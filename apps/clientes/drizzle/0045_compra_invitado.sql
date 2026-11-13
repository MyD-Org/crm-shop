-- Compra como invitado (change `compra-como-invitado`, rebanada S1). Sin UI: el flag
-- `compra-invitado` sigue apagado y con él apagado nada cambia.
--
--   compra_invitado          marca el pedido hecho sin cuenta. El invitado se autoriza con un token
--                            firmado (lib/pedido-token.ts): no hay columna de token ni hash.
--   aviso_pago_pendiente_en  cuándo salió el aviso único «Su pedido está pendiente de pago» (cron
--                            pagos-reconciliar, a los 30 minutos). NULL = todavía no.
--   orders_invitado_email_idx  índice parcial para el tope de pedidos pendientes por email y para el
--                            reclamo al crear la cuenta; sólo las filas de invitado sin dueño.
--
-- ADITIVA: dos columnas (una con DEFAULT false, otra nullable) y un índice. Sin backfill: los pedidos
-- anteriores quedan con compra_invitado = false y fuera del índice.
--
-- Esta migración tiene que correr ANTES de desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta), sólo después de apagar
-- el flag y de que el CRM deje de leer las columnas:
--   DROP INDEX "shop"."orders_invitado_email_idx";
--   ALTER TABLE "shop"."orders" DROP COLUMN "aviso_pago_pendiente_en";
--   ALTER TABLE "shop"."orders" DROP COLUMN "compra_invitado";
ALTER TABLE "shop"."orders" ADD COLUMN "compra_invitado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "aviso_pago_pendiente_en" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_invitado_email_idx" ON "shop"."orders" USING btree ("tenant_id",lower("cliente_email"),"created_at") WHERE "shop"."orders"."compra_invitado" and "shop"."orders"."clerk_user_id" is null and "shop"."orders"."cliente_codigo" is null;
