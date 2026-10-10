-- Forma de pago por condición de lista (change `listas-por-forma-de-pago`, rebanada A): un medio
-- (mercadopago o payway) puede tener una lista de precios distinta según la forma de pago.
--
-- Qué cambia: `lista_precio_condiciones.forma text NULL` con valores credito | debito | cuenta_mp.
-- NULL = todas las formas (comportamiento anterior). Sólo en filas de pago único (cuotas NULL).
-- CHECK: forma IS NULL OR (cuotas IS NULL AND forma IN ('credito','debito','cuenta_mp')).
-- Que payway no admita cuenta_mp, y que sólo mercadopago/payway usen forma, se valida en la
-- aplicación (no en el CHECK, para no acoplar el esquema a slugs).
-- El índice único pasa a ser (tenant_id, medio_slug, coalesce(cuotas,0), coalesce(forma,'')).
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK `lista_precio_condiciones_forma_chk`.
--
-- El SELECT de `shop_app` sobre la tabla ya es de tabla entera (0065): sin GRANT nuevo.
--
-- Aditiva: el Shop viejo ignora la columna; el nuevo la lee en una consulta tolerante a la columna
-- ausente. Igual: aplicar en prod ANTES de abrir el PR. Sin filas con forma, nada cambia.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DELETE FROM "lista_precio_condiciones" WHERE "forma" IS NOT NULL;
--   DROP INDEX "lista_precio_condiciones_uniq";
--   CREATE UNIQUE INDEX "lista_precio_condiciones_uniq" ON "lista_precio_condiciones" USING btree ("tenant_id","medio_slug",coalesce("cuotas", 0));
--   ALTER TABLE "lista_precio_condiciones" DROP CONSTRAINT "lista_precio_condiciones_forma_chk";
--   ALTER TABLE "lista_precio_condiciones" DROP COLUMN "forma";

ALTER TABLE "lista_precio_condiciones" ADD COLUMN "forma" text;
--> statement-breakpoint
ALTER TABLE "lista_precio_condiciones" ADD CONSTRAINT "lista_precio_condiciones_forma_chk" CHECK ("forma" IS NULL OR ("cuotas" IS NULL AND "forma" IN ('credito','debito','cuenta_mp')));
--> statement-breakpoint
DROP INDEX "lista_precio_condiciones_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "lista_precio_condiciones_uniq" ON "lista_precio_condiciones" USING btree ("tenant_id","medio_slug",coalesce("cuotas", 0),coalesce("forma", ''));
