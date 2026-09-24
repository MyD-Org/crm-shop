-- 0010 (change contacto-fuente-unica): por qué un pedido requiere revisión.
-- Texto libre SIN CHECK a propósito (sumar un motivo no pide migración); valores
-- de hoy en src/lib/motivo-revision.ts: documento_incompatible,
-- condicion_iva_desconocida, facturacion_en_pedido, otra_lista_precios.
-- NULL en los pedidos anteriores (el CRM muestra el texto genérico).
-- shop_app ya la puede leer y escribir: sus privilegios son por tabla.
-- Compatible hacia atrás (columna nullable): aplicarla ANTES del merge. El CRM
-- selecciona la columna y sin ella el listado de pedidos del admin falla.
-- Reversa: ALTER TABLE shop.orders DROP COLUMN motivo_revision;
ALTER TABLE "shop"."orders" ADD COLUMN "motivo_revision" text;