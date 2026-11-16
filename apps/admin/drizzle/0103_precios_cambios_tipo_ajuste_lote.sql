-- Selección masiva de productos con porcentajes por lista (change `listas-alegra-desde-costo`, R5).
-- Una asignación masiva deja UNA sola entrada de historial tipo 'ajuste_lote' (objeto `lote:<uuid>`),
-- en vez de una línea por producto y lista. Sólo cambia el CHECK de tipos de precios_online_cambios:
-- se reescribe COMPLETO sobre el vigente (0097) y suma 'ajuste_lote'. Sin tablas ni columnas nuevas.
--
-- Drift que vive SOLO en SQL: este CHECK (schema.ts no lo declara).
--
-- Reversa (en una migración nueva): DELETE FROM precios_online_cambios WHERE tipo = 'ajuste_lote';
-- y volver a crear el CHECK con la lista de 0097.
ALTER TABLE "precios_online_cambios" DROP CONSTRAINT "precios_online_cambios_tipo_chk";--> statement-breakpoint
ALTER TABLE "precios_online_cambios" ADD CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN ('lista_alta','lista_edicion','lista_baja','referencia','override_alta','override_edicion','override_baja','umbral','condicion','revertir','costo_aprobado','costo_rechazado','mapeo','campania','cupon','ajuste_lote'));
