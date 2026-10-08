-- Marcas de tarjeta por condición de cuotas (change `cuotas-en-el-formulario`, rebanada 2): una
-- cantidad de cuotas sin interés puede valer sólo para algunas tarjetas (p. ej. 6 cuotas sólo con
-- Visa y Mastercard).
--
-- Qué cambia: `lista_precio_condiciones.marcas text[] NULL`, ids canónicos en minúscula (visa,
-- mastercard, amex, naranja, cabal, argencard, diners; lista en src/lib/marcas-tarjeta.ts).
-- NULL = todas las tarjetas (comportamiento anterior). Vacío es inválido. Sólo en filas de cuotas.
-- CHECK: marcas IS NULL OR (cuotas IS NOT NULL AND 1..20 elementos AND ids [a-z0-9]+).
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK `lista_precio_condiciones_marcas_chk`.
--
-- El SELECT de `shop_app` sobre la tabla ya es de tabla entera (0065): sin GRANT nuevo.
--
-- Aditiva: el Shop viejo ignora la columna; el nuevo la lee en una consulta tolerante a la columna
-- ausente (=> todas las tarjetas). Igual: aplicar en prod ANTES de abrir el PR.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "lista_precio_condiciones" DROP CONSTRAINT "lista_precio_condiciones_marcas_chk";
--   ALTER TABLE "lista_precio_condiciones" DROP COLUMN "marcas";

ALTER TABLE "lista_precio_condiciones" ADD COLUMN "marcas" text[];
--> statement-breakpoint
ALTER TABLE "lista_precio_condiciones" ADD CONSTRAINT "lista_precio_condiciones_marcas_chk" CHECK ("marcas" IS NULL OR ("cuotas" IS NOT NULL AND cardinality("marcas") BETWEEN 1 AND 20 AND array_to_string("marcas", ',') ~ '^[a-z0-9]+(,[a-z0-9]+)*$'));
