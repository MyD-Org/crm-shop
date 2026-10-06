-- Monto mínimo opcional por condición de cuotas (change `payway-cobro`, rebanada 0).
--
-- Qué cambia: `lista_precio_condiciones.monto_minimo numeric(14,2) NULL`. Sólo tiene sentido en las
-- filas de cuotas (>= 2): una cantidad de cuotas se ofrece únicamente si el total CON impuestos a la
-- lista del pago único del medio alcanza ese monto. NULL = sin mínimo (comportamiento anterior).
-- CHECK: monto_minimo IS NULL OR (cuotas IS NOT NULL AND monto_minimo >= 0).
--
-- Aditiva: el Shop viejo ignora la columna. El SELECT de `shop_app` sobre la tabla ya es de tabla
-- entera (0065), así que NO hace falta un GRANT nuevo.
--
-- Aplicar en prod ANTES de abrir el PR / desplegar el código nuevo.
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK `lista_precio_condiciones_monto_minimo_chk`.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "lista_precio_condiciones" DROP CONSTRAINT "lista_precio_condiciones_monto_minimo_chk";
--   ALTER TABLE "lista_precio_condiciones" DROP COLUMN "monto_minimo";

ALTER TABLE "lista_precio_condiciones" ADD COLUMN "monto_minimo" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "lista_precio_condiciones" ADD CONSTRAINT "lista_precio_condiciones_monto_minimo_chk" CHECK ("monto_minimo" IS NULL OR ("cuotas" IS NOT NULL AND "monto_minimo" >= 0));
