-- Audiencia de los medios de pago (change `listas-cuenta-corriente`, rebanada B): un medio puede ser
-- "solo cuentas corrientes". El público no lo ve en el checkout ni en "con medio" ni en la ficha, y
-- el Shop lo rechaza en el servidor; lo usan los clientes con cuenta corriente (rebanada D).
--
-- Qué cambia: `medios_pago_shop.audiencia text NOT NULL DEFAULT 'publico'`, con CHECK IN
-- ('publico', 'cuenta_corriente'). Sin tocar datos: ningún medio existente cambia de audiencia (el
-- operador marca el suyo desde el admin: Cuotas > Medios de pago del checkout).
--
-- Reglas en la base (drift que vive SOLO en SQL, no está en src/db/schema.ts):
--  - Índice único parcial `medios_pago_shop_tenant_cc_uniq`: a lo sumo UN medio de cuenta corriente
--    por tenant (sí está declarado en schema.ts).
--  - CHECK `medios_pago_shop_audiencia_cc_chk`: un medio de cuenta corriente no cobra en línea ni se
--    destaca en el catálogo ni en la ficha (esas superficies son públicas).
--  - CHECK `medios_pago_shop_audiencia_chk`: solo los dos valores.
--
-- El GRANT SELECT de `shop_app` sobre la tabla ya es de tabla entera (0046): la columna nueva se lee
-- sin GRANT adicional. Se repite, idempotente y condicional, por consistencia con las demás.
--
-- Aditiva: el Shop viejo ignora la columna; el nuevo la lee. Aplicar en prod ANTES de abrir el PR /
-- desplegar el código nuevo (una consulta del Shop con la columna ausente falla y el pago sale a coordinar).
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP INDEX "medios_pago_shop_tenant_cc_uniq";
--   ALTER TABLE "medios_pago_shop" DROP CONSTRAINT "medios_pago_shop_audiencia_cc_chk";
--   ALTER TABLE "medios_pago_shop" DROP CONSTRAINT "medios_pago_shop_audiencia_chk";
--   ALTER TABLE "medios_pago_shop" DROP COLUMN "audiencia";

ALTER TABLE "medios_pago_shop" ADD COLUMN "audiencia" text DEFAULT 'publico' NOT NULL;
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD CONSTRAINT "medios_pago_shop_audiencia_chk" CHECK ("audiencia" IN ('publico', 'cuenta_corriente'));
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD CONSTRAINT "medios_pago_shop_audiencia_cc_chk" CHECK ("audiencia" = 'publico' OR (NOT "cobro_online" AND NOT "destacar_en_catalogo" AND NOT "mostrar_en_ficha"));
--> statement-breakpoint
CREATE UNIQUE INDEX "medios_pago_shop_tenant_cc_uniq" ON "medios_pago_shop" ("tenant_id") WHERE "audiencia" = 'cuenta_corriente';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."medios_pago_shop" TO shop_app;
  END IF;
END $$;
