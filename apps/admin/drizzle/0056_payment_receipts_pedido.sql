-- Comprobante de transferencia por pedido, también para compradores NO vinculados a una cuenta
-- corriente (change `pago-transferencia-comprobante`, rebanada C).
--
-- Hasta acá un comprobante exigía `codigocliente` (contacto de Alegra): sólo lo podía informar un
-- cliente con cuenta corriente. Ahora lo puede informar cualquier comprador logueado desde su
-- pedido de la tienda (`shop.orders`):
--   - `codigocliente` pasa a admitir NULL (comprador sin cuenta corriente).
--   - `shop_order_id`: pedido al que corresponde el comprobante. SIN FK: vive en otro esquema
--     (`shop`), cuyo DDL es del Shop; el vínculo lo valida la app.
--   - `clerk_user_id`: quién lo subió (ancla de la identidad del Shop); es el dueño del comprobante
--     cuando no hay `codigocliente`.
--   - CHECK: o hay `codigocliente` (flujo de siempre) o hay pedido Y usuario (comprador no vinculado).
--     Las filas existentes cumplen la primera rama.
--   - Índices: por pedido (tope y listado del backoffice) y por usuario (tope diario).
--
-- Permisos de `shop_app`: la 0032 le dio SELECT e INSERT sobre la TABLA entera (no por columna), que
-- cubre las dos columnas nuevas; el UPDATE sigue limitado a las columnas del flujo de informar pago
-- y NO incluye ninguna de las nuevas (se escriben sólo en el INSERT). No hace falta GRANT nuevo.
--
-- Drift que vive SOLO en SQL: el CHECK. Los índices y las columnas sí están en schema.ts.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop el flujo por pedido):
--   DROP INDEX payment_receipts_tenant_clerk_created_idx, payment_receipts_tenant_pedido_idx;
--   ALTER TABLE payment_receipts DROP CONSTRAINT payment_receipts_dueno_check;
--   ALTER TABLE payment_receipts DROP COLUMN shop_order_id, DROP COLUMN clerk_user_id;
--   -- `codigocliente` NO vuelve a NOT NULL si ya hay filas con NULL (habría que borrarlas o
--   -- completarlas antes): sin esa limpieza, el SET NOT NULL falla.
ALTER TABLE "payment_receipts" ALTER COLUMN "codigocliente" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "shop_order_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_dueno_check"
  CHECK ("codigocliente" IS NOT NULL OR ("shop_order_id" IS NOT NULL AND "clerk_user_id" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "payment_receipts_tenant_pedido_idx" ON "payment_receipts" USING btree ("tenant_id","shop_order_id");--> statement-breakpoint
CREATE INDEX "payment_receipts_tenant_clerk_created_idx" ON "payment_receipts" USING btree ("tenant_id","clerk_user_id","created_at" desc);
