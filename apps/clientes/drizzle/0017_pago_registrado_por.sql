-- Quién registró el último pago OFFLINE desde el CRM ("Registrar pago" del detalle del pedido).
-- Sólo agrega dos columnas nullable: no reescribe filas ni toma locks largos. Las escribe el CRM;
-- el Shop no las lee todavía.
ALTER TABLE "shop"."orders" ADD COLUMN "pago_registrado_por" uuid;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "pago_registrado_por_nombre" text;